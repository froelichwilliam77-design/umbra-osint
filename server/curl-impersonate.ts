import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import pLimit from "p-limit";
import type { HttpRequest, HttpResponse } from "./http.ts";
import { bodyLimit, impersonateMax } from "./limits.ts";
import { isSoftMemoryPressure } from "./memory.ts";

const CANDIDATES = [
  process.env.UMBRA_CURL_IMPERSONATE,
  "/usr/local/bin/curl_chrome146",
  "/usr/local/bin/curl_chrome142",
  "/usr/local/bin/curl_chrome136",
  "/usr/local/bin/curl_chrome131",
  "/opt/curl-impersonate/curl_chrome146",
  "/opt/curl-impersonate/curl_chrome142",
  "/opt/curl-impersonate/curl_chrome136",
  "/opt/curl-impersonate/curl_chrome131",
  "curl_chrome146",
  "curl_chrome136",
  "curl_chrome131",
  "curl-impersonate",
].filter((x): x is string => Boolean(x));

let cachedBin: string | null | undefined;
const liveChildren = new Set<ChildProcess>();
let curlGate: ReturnType<typeof pLimit> | null = null;
let curlGateN = 0;

function getCurlGate() {
  const n = impersonateMax();
  if (!curlGate || curlGateN !== n) {
    curlGate = pLimit(n);
    curlGateN = n;
  }
  return curlGate;
}

function which(bin: string): string | null {
  if (bin.includes("/") && existsSync(bin)) return bin;
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    const full = join(dir, bin);
    if (existsSync(full)) return full;
  }
  return existsSync(bin) ? bin : null;
}

export function impersonateBinary(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  for (const c of CANDIDATES) {
    const found = which(c);
    if (found) {
      cachedBin = found;
      return found;
    }
  }
  cachedBin = null;
  return null;
}

export function impersonateAvailable(): boolean {
  return impersonateBinary() !== null;
}

export { impersonateMax };

export function tlsMode(): "off" | "auto" | "always" {
  const raw = (process.env.UMBRA_TLS ?? "auto").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "always" || raw === "on" || raw === "1") return "always";
  return "auto";
}

const WAF_HEAVY =
  /cloudflare|akamai|fastly|imperva|incapsula|sucuri|ddos|captcha|waf|perimeter|datadome|kasada|cf-ray/i;

/** Hosts that soft-block generic TLS (Power uses curl-impersonate). Hostname, not CDN brand. */
const TLS_SCRAPER_HOSTS = /(?:^|\.)reddit\.com$/i;

export function isWafHeavy(opts: { protection?: string[]; url?: string }): boolean {
  if (opts.protection?.some((p) => WAF_HEAVY.test(p))) return true;
  const host = (() => {
    try {
      return new URL(opts.url ?? "").hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (!host) return false;
  if (TLS_SCRAPER_HOSTS.test(host)) return true;
  return WAF_HEAVY.test(host);
}

export function shouldImpersonate(opts: {
  protection?: string[];
  url?: string;
  force?: boolean;
  oracle?: boolean;
}): boolean {
  if (!impersonateAvailable()) return false;
  if (impersonateMax() <= 0) return false;
  if (isSoftMemoryPressure()) return false;
  const mode = tlsMode();
  if (mode === "off") return false;
  if (opts.force) return true;
  if (mode === "always") return true;
  // Prefer undici unless the host is WAF-heavy. Mail oracles and generic
  // protection[] lists used to spawn curl children on every probe.
  return isWafHeavy(opts);
}

function parseHeaderBlob(raw: string): { status: number; headers: Record<string, string>; location?: string } {
  const blocks = raw.split(/\r?\n\r?\n/).filter((b) => /HTTP\/\d/i.test(b));
  const last = blocks[blocks.length - 1] ?? raw;
  const lines = last.split(/\r?\n/).filter(Boolean);
  const statusLine = lines.find((l) => /^HTTP\/\d/i.test(l)) ?? "";
  const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
  }
  return { status, headers, location: headers.location };
}

export function killImpersonateChildren(): void {
  for (const child of liveChildren) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  liveChildren.clear();
}

function spawnCurl(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "ignore", "pipe"] });
    liveChildren.add(child);
    let stderr = "";
    child.stderr?.on("data", (d) => {
      if (stderr.length >= 8_192) return;
      stderr += String(d).slice(0, 8_192 - stderr.length);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs + 500);
    const done = (code: number, err = stderr) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve({ code, stderr: err });
    };
    child.on("close", (code) => done(code ?? 1));
    child.on("error", (err) => done(1, err.message));
  });
}

async function readCappedFile(path: string, max: number): Promise<string> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(path, "r");
    const buf = Buffer.alloc(Math.max(1, max));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

function skipped(req: HttpRequest, started: number, error: string): HttpResponse {
  return {
    ok: false,
    status: 0,
    url: req.url,
    finalUrl: req.url,
    headers: {},
    body: "",
    latencyMs: Date.now() - started,
    error,
    via: "curl-impersonate",
  };
}

export async function fetchImpersonate(req: HttpRequest): Promise<HttpResponse> {
  const started = Date.now();
  if (impersonateMax() <= 0) {
    return skipped(req, started, "curl-impersonate disabled (UMBRA_CURL_MAX=0)");
  }
  if (isSoftMemoryPressure()) {
    killImpersonateChildren();
    return skipped(req, started, "curl-impersonate skipped: memory pressure");
  }
  const cap = Math.max(1, impersonateMax());
  if (liveChildren.size >= cap) {
    return skipped(req, started, "curl-impersonate at child-process cap");
  }
  const gate = getCurlGate();
  if (gate.activeCount >= cap) {
    return skipped(req, started, "curl-impersonate at concurrency cap");
  }
  return gate(() => fetchImpersonateInner(req, started));
}

async function fetchImpersonateInner(req: HttpRequest, started: number): Promise<HttpResponse> {
  if (isSoftMemoryPressure()) {
    return skipped(req, started, "curl-impersonate skipped: memory pressure");
  }
  const bin = impersonateBinary();
  if (!bin) {
    return skipped(req, started, "curl-impersonate not installed");
  }
  const dir = await mkdtemp(join(tmpdir(), "umbra-curl-"));
  const headerFile = join(dir, "h");
  const bodyFile = join(dir, "b");
  const method = (req.method ?? "GET").toUpperCase();
  const timeoutMs = req.timeoutMs ?? 12_000;
  const limit = bodyLimit();
  const args = [
    bin,
    "-sS",
    "--compressed",
    "--http2",
    "--max-redirs",
    "0",
    "--connect-timeout",
    "8",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    "--max-filesize",
    String(limit),
    "-D",
    headerFile,
    "-o",
    bodyFile,
    "-X",
    method,
  ];
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      args.push("-H", `${k}: ${v}`);
    }
  }
  if (req.accept) args.push("-H", `Accept: ${req.accept}`);
  if (req.body) {
    const payload = join(dir, "p");
    await writeFile(payload, req.body);
    args.push("--data-binary", `@${payload}`);
  }
  args.push(req.url);
  try {
    const { code, stderr } = await spawnCurl(args, timeoutMs);
    const headerRaw = await readCappedFile(headerFile, 32_000);
    const body = await readCappedFile(bodyFile, limit);
    const parsed = parseHeaderBlob(headerRaw);
    let finalUrl = req.url;
    if (parsed.location) {
      try {
        finalUrl = new URL(parsed.location, req.url).href;
      } catch {
        finalUrl = parsed.location;
      }
    }
    if (code !== 0 && parsed.status === 0) {
      return {
        ok: false,
        status: 0,
        url: req.url,
        finalUrl: req.url,
        headers: {},
        body,
        latencyMs: Date.now() - started,
        error: stderr.trim() || `curl-impersonate exit ${code}`,
        via: "curl-impersonate",
      };
    }
    return {
      ok: parsed.status >= 200 && parsed.status < 300,
      status: parsed.status,
      url: req.url,
      finalUrl,
      location: parsed.location,
      headers: parsed.headers,
      body,
      latencyMs: Date.now() - started,
      via: "curl-impersonate",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function impersonateHealth(): {
  tlsImpersonation: boolean;
  tlsBinary: string | null;
  tlsMode: string;
  tlsNote: string;
} {
  const bin = impersonateBinary();
  return {
    tlsImpersonation: Boolean(bin),
    tlsBinary: bin,
    tlsMode: tlsMode(),
    tlsNote: bin
      ? `curl-impersonate via ${bin} (Chrome TLS + HTTP/2). Mode=${tlsMode()}. Max ${impersonateMax()} concurrent children. Used only for WAF-heavy hosts; undici otherwise.`
      : "curl-impersonate not on PATH. Node/undici HTTP/2 + Chrome headers still run. Install curl-impersonate or rebuild the Docker image (bundles curl_chrome*). Playwright stays off unless UMBRA_PLAYWRIGHT=1 (not for 1 GB Railway).",
  };
}
