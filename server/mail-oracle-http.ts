import type { LedgerRow } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import type { HttpResponse } from "./http.ts";
import { classifyOracleBody, type OracleVerdict } from "./oracles.ts";

export function wrapHttp(
  res: HttpResponse,
  url: string,
  method: string,
): { verdict: OracleVerdict; extras: Partial<LedgerRow> } {
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
