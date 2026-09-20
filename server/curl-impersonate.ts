import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { HttpRequest, HttpResponse } from "./http.ts";

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

export function tlsMode(): "off" | "auto" | "always" {
  const raw = (process.env.UMBRA_TLS ?? "auto").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "always" || raw === "on" || raw === "1") return "always";
  return "auto";
}

export function shouldImpersonate(opts: { protection?: string[]; url?: string; force?: boolean }): boolean {
  if (!impersonateAvailable()) return false;
  const mode = tlsMode();
  if (mode === "off") return false;
  if (mode === "always" || opts.force) return true;
  if (opts.protection?.length) return true;
  const host = (() => {
    try {
      return new URL(opts.url ?? "").hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return /cloudflare|akamai|fastly|imperva|sucuri/.test(host);
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

function spawnCurl(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs + 500);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stderr: err.message });
    });
  });
}

export async function fetchImpersonate(req: HttpRequest): Promise<HttpResponse> {
  const bin = impersonateBinary();
  const started = Date.now();
  if (!bin) {
    return {
      ok: false,
      status: 0,
      url: req.url,
      finalUrl: req.url,
      headers: {},
      body: "",
      latencyMs: 0,
      error: "curl-impersonate not installed",
      via: "curl-impersonate",
    };
  }
  const dir = await mkdtemp(join(tmpdir(), "umbra-curl-"));
  const headerFile = join(dir, "h");
  const bodyFile = join(dir, "b");
  const method = (req.method ?? "GET").toUpperCase();
  const timeoutMs = req.timeoutMs ?? 12_000;
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
    let headerRaw = "";
    let body = "";
    try {
      headerRaw = await readFile(headerFile, "utf8");
    } catch {
      headerRaw = "";
    }
    try {
      body = await readFile(bodyFile, "utf8");
    } catch {
      body = "";
    }
    if (body.length > 512_000) body = body.slice(0, 512_000);
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
      ? `curl-impersonate via ${bin} (Chrome TLS + HTTP/2). Mode=${tlsMode()}. Protected/WAF hosts use it automatically; set UMBRA_TLS=always to force.`
      : "curl-impersonate not on PATH. Node/undici HTTP/2 + Chrome headers still run. Install curl-impersonate or rebuild the Docker image (bundles curl_chrome*). Optional Playwright: UMBRA_PLAYWRIGHT=1 after `npx playwright install chromium`.",
  };
}
