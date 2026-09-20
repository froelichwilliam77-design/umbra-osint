import type { LedgerRow } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import { fetchImpersonate, impersonateAvailable, shouldImpersonate, tlsMode } from "./curl-impersonate.ts";
import { fetchPublic, type HttpRequest, type HttpResponse } from "./http.ts";
import { finalizeOracleVerdict, parseMaybeJson } from "./mail-oracle-recover.ts";
import { classifyOracleBody, type OracleVerdict } from "./oracles.ts";
import {
  fetchPlaywright,
  playwrightEnabled,
  shouldEscalateBrowser,
  stillChallenged,
  takePlaywrightSlot,
} from "./playwright-pool.ts";
import { assertSafeFetchTarget } from "./ssrf.ts";

export type OraclePack = { verdict: OracleVerdict; extras: Partial<LedgerRow> };

function extrasOf(res: HttpResponse, url: string, method: string): Partial<LedgerRow> {
  return {
    url,
    method,
    httpStatus: res.status,
    latencyMs: res.latencyMs,
    finalUrl: res.finalUrl,
    bodyExcerpt: excerpt(res.body),
    via: res.via,
  };
}

export function wrapHttp(res: HttpResponse, url: string, method: string): OraclePack {
  return {
    verdict: classifyOracleBody(res),
    extras: extrasOf(res, url, method),
  };
}

function oracleHeaders(req: HttpRequest): Record<string, string> {
  let origin = "";
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = "";
  }
  return {
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "X-Requested-With": "XMLHttpRequest",
    ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
    ...req.headers,
  };
}

/**
 * Mail-oracle fetch: Chrome CORS headers, curl-impersonate first when present,
 * Playwright GET-only retry for challenge pages (no logins).
 */
export async function fetchOracle(req: HttpRequest): Promise<HttpResponse> {
  const withHeaders: HttpRequest = {
    ...req,
    accept: req.accept ?? "application/json, text/plain, */*",
    headers: oracleHeaders(req),
  };
  const method = (req.method ?? "GET").toUpperCase();
  const impersonateFirst =
    impersonateAvailable() &&
    tlsMode() !== "off" &&
    (shouldImpersonate({ protection: ["waf"], url: req.url, oracle: true }) || tlsMode() === "always" || tlsMode() === "auto");

  let impersonated: HttpResponse | undefined;
  if (impersonateFirst) {
    impersonated = await fetchImpersonate(withHeaders);
    if (impersonated.status > 0 && !stillChallenged(impersonated)) return impersonated;
  }

  let res = await fetchPublic(withHeaders);
  if (
    impersonateAvailable() &&
    tlsMode() !== "off" &&
    !impersonateFirst &&
    (res.status === 403 || res.status === 429 || stillChallenged(res))
  ) {
    const retry = await fetchImpersonate(withHeaders);
    if (retry.status > 0) res = retry;
  } else if (impersonated && stillChallenged(res) && impersonated.status > 0) {
    res = impersonated;
  } else if (impersonated && res.status === 0 && impersonated.status > 0) {
    res = impersonated;
  }

  if (
    playwrightEnabled() &&
    method === "GET" &&
    (stillChallenged(res) || res.status === 403) &&
    takePlaywrightSlot() &&
    shouldEscalateBrowser("blocked", stillChallenged(res) ? "cloudflare challenge" : "HTTP 403", method)
  ) {
    const pw = await fetchPlaywright({ ...withHeaders, method: "GET", timeoutMs: withHeaders.timeoutMs ?? 18_000 });
    if (pw.status > 0 && !pw.ssrf && !stillChallenged(pw)) return pw;
  }
  return res;
}

export async function fetchOracleFollow(req: HttpRequest, maxRedirects = 5): Promise<HttpResponse> {
  let current = req.url;
  const chain: string[] = [current];
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetchOracle({ ...req, url: current });
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

export function pack(res: HttpResponse, url: string, method: string, verdict: OracleVerdict): OraclePack {
  return {
    verdict: finalizeOracleVerdict(res, verdict),
    extras: extrasOf(res, url, method),
  };
}

export function precheck(res: HttpResponse, url: string, method: string): OraclePack | null {
  if (res.ssrf || (res.error && res.status === 0)) return wrapHttp(res, url, method);
  const blocked = classifyOracleBody(res);
  if (blocked.status === "blocked" || blocked.status === "error" || blocked.status === "invalid") {
    return pack(res, url, method, blocked);
  }
  return null;
}

export function cookieHeader(res: HttpResponse): string {
  const raw = res.headers["set-cookie"] ?? "";
  if (!raw) return "";
  return raw
    .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

export function csrfToken(html: string): string | undefined {
  const patterns = [
    /name=["']csrf-token["']\s+content=["']([^"']+)/i,
    /content=["']([^"']+)["']\s+name=["']csrf-token["']/i,
    /name=["'](?:csrf|_token|authenticity_token|csrfmiddlewaretoken|csrfAjaxToken)["'][^>]*value=["']([^"']+)/i,
    /value=["']([^"']+)["'][^>]*name=["'](?:csrf|_token|authenticity_token|csrfmiddlewaretoken)["']/i,
    /"csrf(?:Ajax)?Token"\s*:\s*"([^"]+)"/i,
    /csrfmiddlewaretoken["']\s+value=["']([^"']+)/i,
    /data-xsrf=["']([^"']+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export function takenOrAvailable(
  res: HttpResponse,
  url: string,
  method: string,
  opts: { taken: string[]; available?: string[]; foundReason: string; missReason: string },
): OraclePack {
  const early = precheck(res, url, method);
  if (early) return early;
  const body = res.body.toLowerCase();
  if (opts.taken.some((t) => body.includes(t.toLowerCase()))) {
    return pack(res, url, method, { status: "found", reason: opts.foundReason });
  }
  if (opts.available?.some((t) => body.includes(t.toLowerCase()))) {
    return pack(res, url, method, { status: "miss", reason: opts.missReason });
  }
  return wrapHttp(res, url, method);
}

export function jsonStatus(
  res: HttpResponse,
  url: string,
  method: string,
  interpret: (json: unknown) => OracleVerdict,
): OraclePack {
  if (res.ssrf || (res.error && res.status === 0)) return wrapHttp(res, url, method);
  const blocked = classifyOracleBody(res);
  if (blocked.status === "blocked" || blocked.status === "error" || blocked.status === "invalid") {
    return { verdict: blocked, extras: extrasOf(res, url, method) };
  }
  const json = parseMaybeJson(res.body);
  if (json !== undefined) {
    return {
      verdict: finalizeOracleVerdict(res, interpret(json)),
      extras: extrasOf(res, url, method),
    };
  }
  return {
    verdict: finalizeOracleVerdict(res, { status: "escalate", reason: `Non-JSON oracle response (HTTP ${res.status}).` }),
    extras: extrasOf(res, url, method),
  };
}
