import type { LedgerRow } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import { fetchPublic, type HttpRequest, type HttpResponse } from "./http.ts";
import { classifyOracleBody, type OracleVerdict } from "./oracles.ts";

export type OraclePack = { verdict: OracleVerdict; extras: Partial<LedgerRow> };

export function wrapHttp(res: HttpResponse, url: string, method: string): OraclePack {
  return {
    verdict: classifyOracleBody(res),
    extras: {
      url,
      method,
      httpStatus: res.status,
      latencyMs: res.latencyMs,
      finalUrl: res.finalUrl,
      bodyExcerpt: excerpt(res.body),
    },
  };
}

/** Browser CORS/XHR headers — better than document/navigate against WAF-heavy APIs. */
export async function fetchOracle(req: HttpRequest): Promise<HttpResponse> {
  let origin = "";
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = "";
  }
  return fetchPublic({
    ...req,
    accept: req.accept ?? "application/json, text/plain, */*",
    headers: {
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "X-Requested-With": "XMLHttpRequest",
      ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
      ...req.headers,
    },
  });
}

export function pack(res: HttpResponse, url: string, method: string, verdict: OracleVerdict): OraclePack {
  return {
    verdict,
    extras: {
      url,
      method,
      httpStatus: res.status,
      latencyMs: res.latencyMs,
      finalUrl: res.finalUrl,
      bodyExcerpt: excerpt(res.body),
    },
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
): { verdict: OracleVerdict; extras: Partial<LedgerRow> } {
  if (res.ssrf || (res.error && res.status === 0)) return wrapHttp(res, url, method);
  const blocked = classifyOracleBody(res);
  if (blocked.status === "blocked" || blocked.status === "error" || blocked.status === "invalid") {
    return { verdict: blocked, extras: { url, method, httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) } };
  }
  try {
    const json = JSON.parse(res.body) as unknown;
    return {
      verdict: interpret(json),
      extras: { url, method, httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
    };
  } catch {
    return {
      verdict: { status: "escalate", reason: `Non-JSON oracle response (HTTP ${res.status}).` },
      extras: { url, method, httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
    };
  }
}
