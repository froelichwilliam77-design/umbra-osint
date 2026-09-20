import { LOGIN_PATH_HINTS, WAF_BODY_HINTS, WAF_HEADER_HINTS } from "../shared/constants.ts";
import type { LedgerStatus } from "../shared/types.ts";

export interface MatchSpec {
  e_code: number | null;
  e_string: string;
  m_code: number | null;
  m_string: string;
}

export interface ClassifyInput {
  status: number;
  body: string;
  headers: Record<string, string>;
  requestedUrl: string;
  finalUrl?: string;
  location?: string;
  account?: string;
}

export interface ClassifyResult {
  status: LedgerStatus;
  reason: string;
  existHit: boolean;
  missHit: boolean;
  waf: boolean;
}

const SOFT_404 = [
  "page not found",
  "user not found",
  "profile not found",
  "account not found",
  "username not found",
  "nobody by that name",
  "doesn't exist",
  "does not exist",
  "do not exist",
  "no such user",
  "no such account",
  "couldn't find",
  "could not find",
  "can't find that",
  "cannot find",
  "sorry, this page isn't available",
  "this page isn't available",
  "this page is not available",
  "the page you were looking for doesn't exist",
  "the page you requested was not found",
  "we couldn't find that",
  "we can't find that user",
  "user does not exist",
  "account doesn't exist",
  "there is no user",
  "isn't a valid user",
  "is not a valid user",
  "unknown user",
  "unknown username",
  "404 not found",
  "error 404",
  "nothing to see here",
  "no users found",
];

function headerMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

export function includesLoose(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // WMN strings often omit JSON whitespace ("error":404 vs "error": 404).
  return h.replace(/\s+/g, "").includes(n.replace(/\s+/g, ""));
}

export function detectWaf(input: Pick<ClassifyInput, "status" | "body" | "headers">): string | null {
  if (input.status === 403) return "HTTP 403 — treated as blocked, not a miss.";
  if (input.status === 429) return "HTTP 429 rate limit — treated as blocked, not a miss.";
  if (input.status === 451) return "HTTP 451 unavailable for legal reasons — treated as blocked, not a miss.";
  const headers = headerMap(input.headers);
  if (headers["retry-after"] && (input.status === 429 || input.status === 503 || input.status === 403)) {
    return `Retry-After ${headers["retry-after"]} — treated as blocked, not a miss.`;
  }
  for (const hint of WAF_HEADER_HINTS) {
    if (headers[hint]) return `WAF / challenge header ${hint} present.`;
  }
  const cf = headers["server"]?.toLowerCase() ?? "";
  const body = input.body.slice(0, 8000).toLowerCase();
  if (headers["cf-ray"] && (body.includes("just a moment") || body.includes("attention required") || body.includes("cf-challenge"))) {
    return "Cloudflare challenge body (cf-ray + interstitial).";
  }
  if (input.status === 503 && (body.includes("cloudflare") || cf.includes("cloudflare"))) {
    return "Cloudflare challenge / 503.";
  }
  for (const hint of WAF_BODY_HINTS) {
    if (body.includes(hint)) {
      if (hint === "forbidden" && input.status !== 403 && input.status !== 401) continue;
      if (hint === "cloudflare" && !body.includes("challenge") && !body.includes("cf-ray") && !body.includes("attention required") && !body.includes("just a moment")) {
        continue;
      }
      return `Anti-bot / WAF signature in body (${hint}).`;
    }
  }
  if (input.status === 401 && (body.includes("captcha") || body.includes("cf-challenge"))) {
    return "Auth wall with challenge.";
  }
  return null;
}

export function locationLooksLikeProfile(requestedUrl: string, dest: string, account?: string): boolean {
  try {
    const req = new URL(requestedUrl);
    const url = new URL(dest, requestedUrl);
    if (!account) return false;
    const acc = account.toLowerCase();
    const path = url.pathname.toLowerCase();
    const search = url.search.toLowerCase();
    if (path.includes(`/${acc}`) || path.endsWith(`/${acc}`) || path.includes(`/@${acc}`) || search.includes(acc)) {
      return url.hostname === req.hostname || url.hostname.endsWith(`.${req.hostname}`) || req.hostname.endsWith(`.${url.hostname}`);
    }
    return false;
  } catch {
    return false;
  }
}

export function redirectOffProfile(requestedUrl: string, location?: string, finalUrl?: string, account?: string): string | null {
  const dest = finalUrl || location;
  if (!dest) return null;
  let destUrl: URL;
  let reqUrl: URL;
  try {
    reqUrl = new URL(requestedUrl);
    destUrl = new URL(dest, requestedUrl);
  } catch {
    return null;
  }
  if (destUrl.href === reqUrl.href) return null;
  if (locationLooksLikeProfile(requestedUrl, dest, account)) return null;

  const path = destUrl.pathname.toLowerCase();
  for (const hint of LOGIN_PATH_HINTS) {
    if (path === hint || path.startsWith(`${hint}/`) || path.endsWith(hint)) {
      return `Redirected off-profile to ${destUrl.pathname} (${hint}).`;
    }
  }
  if (path === "/" && reqUrl.pathname !== "/") {
    return "Redirected to site root — not a profile.";
  }
  return null;
}

export function dualCondition(spec: MatchSpec, status: number, body: string): {
  existHit: boolean;
  missHit: boolean;
} {
  const existStatus = spec.e_code == null || status === spec.e_code;
  const existBody = spec.e_string === "" || includesLoose(body, spec.e_string);
  const missStatus = spec.m_code == null || status === spec.m_code;
  const missBody = spec.m_string === "" || includesLoose(body, spec.m_string);
  return {
    existHit: existStatus && existBody,
    missHit: missStatus && missBody,
  };
}

export function isSoft404(body: string): boolean {
  const lower = body.slice(0, 12_000).toLowerCase();
  return SOFT_404.some((p) => lower.includes(p));
}

const USERNAME_KEYS = [
  "login",
  "username",
  "user_name",
  "userName",
  "handle",
  "acct",
  "screen_name",
  "screenName",
  "nickname",
  "nick",
  "uid",
  "slug",
];

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function recordHasAccount(obj: Record<string, unknown>, acc: string): boolean {
  for (const key of USERNAME_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.toLowerCase() === acc) return true;
  }
  if (typeof obj.user === "string" && obj.user.toLowerCase() === acc) return true;
  return false;
}

/** True when a JSON body names this account — recovers stale WMN e_strings. */
export function jsonAccountEvidence(body: string, account?: string): boolean {
  if (!account) return false;
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  const acc = account.toLowerCase();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const candidates: unknown[] = [parsed];
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return false;
      candidates.push(parsed[0]);
    }
    const root = asRecord(parsed);
    if (root) {
      candidates.push(root.data, root.user, root.profile, root.entry, root.result, root.them);
      if (Array.isArray(root.items)) candidates.push(root.items[0]);
      if (Array.isArray(root.users)) candidates.push(root.users[0]);
      if (Array.isArray(root.data)) candidates.push(root.data[0]);
    }
    for (const c of candidates) {
      const rec = asRecord(c);
      if (rec && recordHasAccount(rec, acc)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function jsonEmptyCollection(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "[]" || trimmed === "{}" || trimmed === "null") return true;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.length === 0) return true;
    const rec = asRecord(parsed);
    if (!rec) return false;
    if (Array.isArray(rec.items) && rec.items.length === 0) return true;
    if (Array.isArray(rec.users) && rec.users.length === 0) return true;
    if (Array.isArray(rec.data) && rec.data.length === 0) return true;
    if (Array.isArray(rec.them) && rec.them.length === 0) return true;
    return false;
  } catch {
    return false;
  }
}

export function classifyResponse(spec: MatchSpec, input: ClassifyInput): ClassifyResult {
  const waf = detectWaf(input);
  if (waf) {
    return {
      status: "blocked",
      reason: waf,
      existHit: false,
      missHit: false,
      waf: true,
    };
  }

  const dest = input.finalUrl || input.location;
  if (
    dest &&
    input.status >= 300 &&
    input.status < 400 &&
    locationLooksLikeProfile(input.requestedUrl, dest, input.account)
  ) {
    return {
      status: "found",
      reason: `Redirect still points at a /${input.account} profile.`,
      existHit: true,
      missHit: false,
      waf: false,
    };
  }

  const off = redirectOffProfile(input.requestedUrl, input.location, input.finalUrl, input.account);
  if (off && input.status >= 300 && input.status < 400) {
    const { existHit, missHit } = dualCondition(spec, input.status, input.body);
    if (existHit && !missHit) {
      return { status: "found", reason: "Exist conditions matched despite redirect.", existHit, missHit, waf: false };
    }
    return {
      status: "miss",
      reason: off,
      existHit,
      missHit: true,
      waf: false,
    };
  }

  if (jsonAccountEvidence(input.body, input.account) && input.status >= 200 && input.status < 300) {
    return {
      status: "found",
      reason: `JSON body names account "${input.account}" (matcher recovered).`,
      existHit: true,
      missHit: false,
      waf: false,
    };
  }

  const { existHit, missHit } = dualCondition(spec, input.status, input.body);
  if (existHit && missHit) {
    return {
      status: "escalate",
      reason: "Both exist and missing conditions matched — ambiguous.",
      existHit,
      missHit,
      waf: false,
    };
  }
  if (existHit) {
    if (!spec.e_string && input.status === 200 && isSoft404(input.body)) {
      return {
        status: "miss",
        reason: "Soft-404: HTTP 200 but the body reads as a missing profile.",
        existHit: false,
        missHit: true,
        waf: false,
      };
    }
    return {
      status: "found",
      reason: `Exist match (status ${input.status}${spec.e_string ? ` + body` : ""}).`,
      existHit,
      missHit,
      waf: false,
    };
  }
  if (missHit) {
    return {
      status: "miss",
      reason: `Missing match (status ${input.status}${spec.m_string ? ` + body` : ""}).`,
      existHit,
      missHit,
      waf: false,
    };
  }
  if (input.status === 200 && isSoft404(input.body)) {
    return {
      status: "miss",
      reason: "Soft-404 body on HTTP 200 — miss with reason, not a found.",
      existHit: false,
      missHit: true,
      waf: false,
    };
  }
  if ((input.status === 404 || input.status === 410) && !existHit) {
    return {
      status: "miss",
      reason:
        input.status === 410
          ? "HTTP 410 Gone — profile absent (missing-condition body did not need to match)."
          : "HTTP 404 — no profile (status indicates absence even if missing-string drifted).",
      existHit: false,
      missHit: true,
      waf: false,
    };
  }
  if (input.status === 200 && jsonEmptyCollection(input.body) && spec.e_string && !existHit) {
    return {
      status: "miss",
      reason: "HTTP 200 with an empty JSON collection — no matching profile.",
      existHit: false,
      missHit: true,
      waf: false,
    };
  }
  if (input.status === 204 && !existHit) {
    return {
      status: "miss",
      reason: "HTTP 204 No Content — no profile payload.",
      existHit: false,
      missHit: true,
      waf: false,
    };
  }
  return {
    status: "escalate",
    reason: `Neither exist nor missing conditions matched (HTTP ${input.status}).`,
    existHit,
    missHit,
    waf: false,
  };
}

export function excerpt(body: string, needle = "", max = 280): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (needle) {
    const idx = clean.toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      return `${start > 0 ? "…" : ""}${clean.slice(start, start + max)}${start + max < clean.length ? "…" : ""}`;
    }
  }
  return clean.slice(0, max) + (clean.length > max ? "…" : "");
}

export function handleAllowed(handle: string, regex?: string): { ok: boolean; reason?: string } {
  if (!regex) return { ok: true };
  try {
    if (new RegExp(regex).test(handle)) return { ok: true };
    return { ok: false, reason: `Handle does not match site username regex /${regex}/ — skipped.` };
  } catch {
    return { ok: true };
  }
}

export function looksLikeApiUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/api/") ||
    lower.includes("/api?") ||
    lower.endsWith(".json") ||
    lower.includes(".json?") ||
    lower.includes("format=json") ||
    lower.includes("application/json")
  );
}
