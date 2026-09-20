import type { LedgerStatus } from "../shared/types.ts";
import { detectWaf } from "./classify.ts";
import type { HttpResponse } from "./http.ts";

export interface OracleVerdict {
  status: LedgerStatus;
  reason: string;
}

export function classifyOracleBody(res: HttpResponse): OracleVerdict {
  if (res.ssrf) return { status: "invalid", reason: res.error ?? "SSRF blocked" };
  if (res.error && res.status === 0) return { status: "error", reason: res.error };
  const waf = detectWaf({ status: res.status, body: res.body, headers: res.headers });
  if (waf) return { status: "blocked", reason: waf };
  if (res.status >= 500) return { status: "error", reason: `Upstream HTTP ${res.status}` };
  return { status: "escalate", reason: `Unclassified oracle HTTP ${res.status}` };
}
