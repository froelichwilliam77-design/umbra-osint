import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import { assertSafeFetchTarget, SsrfError } from "./ssrf.ts";
import { pickUserAgent } from "./ua.ts";

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  redirect?: "manual" | "follow";
  accept?: string;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  location?: string;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
  error?: string;
  ssrf?: boolean;
}

const DEFAULT_TIMEOUT = 12_000;
const BODY_LIMIT = 512_000;

function defaultHeaders(url: string, accept?: string): Record<string, string> {
  const ua = pickUserAgent();
  const origin = new URL(url).origin;
  return {
    "User-Agent": ua.value,
    Accept: accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Sec-CH-UA": ua.secChUa,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"${ua.platform}"`,
    Referer: `${origin}/`,
  };
}

function createDispatcher(): Dispatcher {
  const proxy = process.env.UMBRA_PROXY?.trim();
  if (proxy) {
    if (proxy.startsWith("socks")) {
      const u = new URL(proxy);
      return socksDispatcher({
        type: 5,
        host: u.hostname,
        port: Number(u.port || 1080),
        userId: u.username || undefined,
        password: u.password || undefined,
      });
    }
    return new ProxyAgent(proxy);
  }
  return new Agent({
    allowH2: true,
    keepAliveTimeout: 10_000,
    connections: 64,
    connect: { timeout: 8_000 },
  });
}

let dispatcher: Dispatcher | undefined;

export function getDispatcher(): Dispatcher {
  dispatcher ??= createDispatcher();
  return dispatcher;
}

export function resetDispatcher(): void {
  dispatcher = undefined;
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function readLimited(res: { text: () => Promise<string> }): Promise<string> {
  const text = await res.text();
  return text.length > BODY_LIMIT ? text.slice(0, BODY_LIMIT) : text;
}

export async function fetchPublic(req: HttpRequest): Promise<HttpResponse> {
  const started = Date.now();
  const method = (req.method ?? "GET").toUpperCase();
  try {
    const url = await assertSafeFetchTarget(req.url);
    const headers = {
      ...defaultHeaders(url.href, req.accept),
      ...req.headers,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT);
    try {
      const res = await undiciFetch(url.href, {
        method,
        headers,
        body: req.body,
        dispatcher: getDispatcher(),
        redirect: req.redirect ?? "manual",
        signal: controller.signal,
      });
      const rec = headerRecord(res.headers);
      const body = await readLimited(res);
      const location = rec.location;
      let finalUrl = url.href;
      if (location) {
        try {
          finalUrl = new URL(location, url.href).href;
        } catch {
          finalUrl = location;
        }
      }
      return {
        ok: res.ok,
        status: res.status,
        url: url.href,
        finalUrl,
        location,
        headers: rec,
        body,
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const ssrf = err instanceof SsrfError;
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      url: req.url,
      finalUrl: req.url,
      headers: {},
      body: "",
      latencyMs: Date.now() - started,
      error: name === "AbortError" ? "timeout" : message,
      ssrf,
    };
  }
}

export async function fetchFollow(req: HttpRequest, maxRedirects = 5): Promise<HttpResponse> {
  let current = req.url;
  const chain: string[] = [current];
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetchPublic({ ...req, url: current, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.location) {
      let next: URL;
      try {
        next = new URL(res.location, current);
      } catch {
        return { ...res, error: `Bad redirect: ${res.location}` };
      }
      try {
        await assertSafeFetchTarget(next.href);
      } catch (err) {
        return {
          ...res,
          error: err instanceof Error ? err.message : String(err),
          ssrf: true,
        };
      }
      current = next.href;
      chain.push(current);
      continue;
    }
    return { ...res, finalUrl: current, url: req.url };
  }
  return {
    ok: false,
    status: 0,
    url: req.url,
    finalUrl: current,
    headers: {},
    body: "",
    latencyMs: 0,
    error: `Too many redirects: ${chain.join(" -> ")}`,
  };
}

export function jitter(minMs = 40, maxMs = 220): Promise<void> {
  const span = Math.max(0, maxMs - minMs);
  const ms = minMs + Math.floor(Math.random() * (span + 1));
  return new Promise((resolve) => setTimeout(resolve, ms));
}
