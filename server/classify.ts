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
  confidence: MatchConfidence;
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
  "esta página no está disponible",
  "esta pagina no esta disponible",
  "página no está disponible",
  "pagina no encontrada",
  "page isn't available",
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
  "item not available",
  "no longer available",
  "this account doesn't exist",
  "this account does not exist",
  "sorry, nobody",
  "user has been suspended",
  "account suspended",
  "profile unavailable",
  "that user does not exist",
  "no profile found",
  "sorry, that page doesn't exist",
  "sorry, that page does not exist",
  "this user does not exist",
  "this user doesn't exist",
  "couldn't find this account",
  "could not find this account",
  "can't find this account",
  "cannot find this account",
  "no one by that username",
  "nobody by that username",
  "username is not registered",
  "the specified user could not be found",
  "user not exist",
  "profile does not exist",
  "profile doesn't exist",
  "isn't available",
  "is not available",
  "cannot find the user",
  "we can't find that account",
  "we couldn't find that account",
  "account not available",
  "no such profile",
];

export type MatchConfidence = "high" | "medium" | "low";

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
  // 403 is not always a WAF — some sites 403 missing profiles. Challenge/rate-limit still block.
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
      if (hint === "ray id" && !body.includes("challenge") && !body.includes("attention required") && !body.includes("just a moment") && !body.includes("blocked")) {
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
    const host = url.hostname.toLowerCase();
    if (
      path.includes(`/${acc}`) ||
      path.includes(`/~${acc}`) ||
      path.includes(`/@${acc}`) ||
      path.endsWith(`/${acc}`) ||
      search.includes(acc) ||
      host.startsWith(`${acc}.`)
    ) {
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
  "display_name",
  "displayName",
  "uniqueName",
  "canonicalName",
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

export function htmlAccountEvidence(body: string, account?: string): boolean {
  if (!account) return false;
  const acc = account.toLowerCase();
  const slice = body.slice(0, 40_000);
  const lower = slice.toLowerCase();
  if (isSoft404(slice)) return false;
  const title = (slice.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] ?? "").toLowerCase();
  const ogTitle = (slice.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i)?.[1]
    ?? slice.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1]
    ?? "").toLowerCase();
  const word = new RegExp(`(?:^|[^a-z0-9])${acc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i");
  if (title && word.test(title) && !/not found|error|unavailable|just a moment/.test(title)) return true;
  if (ogTitle && word.test(ogTitle) && !/not found|error|unavailable/.test(ogTitle)) return true;
  if (lower.includes(`"username":"${acc}"`) || lower.includes(`"username": "${acc}"`)) return true;
  if (lower.includes(`"login":"${acc}"`) || lower.includes(`"handle":"${acc}"`)) return true;
  if (lower.includes(`href="/~${acc}"`) || lower.includes(`href='/~${acc}'`)) return true;
  if (new RegExp(`['"]username['"]\\s*=>\\s*['"]${acc}['"]`, "i").test(slice)) return true;
  const ogUrl = (
    slice.match(/property=["']og:url["'][^>]*content=["']([^"']+)/i)?.[1] ??
    slice.match(/content=["']([^"']+)["'][^>]*property=["']og:url["']/i)?.[1] ??
    slice.match(/rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1] ??
    ""
  ).toLowerCase();
  if (ogUrl && word.test(ogUrl) && !/login|signup|explore|search/.test(ogUrl)) return true;
  return false;
}

export function jsonErrorMissing(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rec = asRecord(parsed);
    if (!rec) return false;
    const msg = String(rec.message ?? rec.error ?? rec.detail ?? rec.reason ?? "").toLowerCase();
    if (/not found|does not exist|doesn't exist|no such user|unknown user|user not found/.test(msg)) return true;
    if (rec.error === 404 || rec.status === 404 || rec.code === 404) return true;
    return false;
  } catch {
    return false;
  }
}

function classified(
  status: LedgerStatus,
  reason: string,
  extra: { existHit: boolean; missHit: boolean; waf: boolean; confidence?: MatchConfidence },
): ClassifyResult {
  return {
    status,
    reason,
    existHit: extra.existHit,
    missHit: extra.missHit,
    waf: extra.waf,
    confidence: extra.confidence ?? inferConfidence(status, reason, extra.waf),
  };
}

export function inferConfidence(status: LedgerStatus, reason: string, waf = false): MatchConfidence {
  const r = reason.toLowerCase();
  if (status === "escalate" || status === "error" || status === "invalid") return "low";
  if (status === "found") {
    if (r.includes("json body names") || r.includes("exist match")) return "high";
    if (r.includes("title/og") || r.includes("redirect still points") || r.includes("drifted")) return "medium";
    return "medium";
  }
  if (status === "miss") {
    if (r.includes("404") || r.includes("410") || r.includes("soft-404") || r.includes("json error") || r.includes("missing match")) {
      return "high";
    }
    return "medium";
  }
  if (status === "blocked") {
    if (waf && (r.includes("429") || r.includes("451") || r.includes("captcha") || r.includes("challenge"))) return "high";
    return "medium";
  }
  return "low";
}

function preferSpecificMatcher(spec: MatchSpec, existHit: boolean, missHit: boolean, status: number): ClassifyResult | null {
  if (!(existHit && missHit)) return null;
  const e = spec.e_string.toLowerCase();
  const m = spec.m_string.toLowerCase();
  if (m && e && m.includes(e) && m.length > e.length) {
    return classified("miss", "Missing-string is more specific than exist-string (substring collision) — miss.", {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if (e && m && e.includes(m) && e.length > m.length) {
    return classified("found", "Exist-string is more specific than missing-string (substring collision) — found.", {
      existHit: true,
      missHit: false,
      waf: false,
      confidence: "high",
    });
  }
  if (status === 404 || status === 410) {
    return classified("miss", `HTTP ${status} wins the exist+missing collision — profile absent.`, {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if (spec.m_code != null && status === spec.m_code && status !== spec.e_code) {
    return classified("miss", `HTTP ${status} matches the missing status in an exist+missing collision.`, {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if (spec.e_code != null && status === spec.e_code && status !== spec.m_code) {
    return classified("found", `HTTP ${status} matches the exist status in an exist+missing collision.`, {
      existHit: true,
      missHit: false,
      waf: false,
      confidence: "high",
    });
  }
  return null;
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

function absenceOnForbidden(input: ClassifyInput): boolean {
  if (input.status !== 403) return false;
  if (isSoft404(input.body) || jsonErrorMissing(input.body) || jsonEmptyCollection(input.body)) return true;
  const t = input.body.slice(0, 2_000).toLowerCase().trim();
  if (!t) return false;
  return /not found|doesn't exist|does not exist|no such user|unknown user/.test(t);
}

export function classifyResponse(spec: MatchSpec, input: ClassifyInput): ClassifyResult {
  const waf = detectWaf(input);
  if (waf) {
    return classified("blocked", waf, { existHit: false, missHit: false, waf: true });
  }

  const dest = input.finalUrl || input.location;
  if (
    dest &&
    input.status >= 300 &&
    input.status < 400 &&
    locationLooksLikeProfile(input.requestedUrl, dest, input.account)
  ) {
    return classified("found", `Redirect still points at a /${input.account} profile.`, {
      existHit: true,
      missHit: false,
      waf: false,
      confidence: "medium",
    });
  }

  const off = redirectOffProfile(input.requestedUrl, input.location, input.finalUrl, input.account);
  if (off && input.status >= 300 && input.status < 400) {
    const { existHit, missHit } = dualCondition(spec, input.status, input.body);
    if (existHit && !missHit) {
      return classified("found", "Exist conditions matched despite redirect.", {
        existHit,
        missHit,
        waf: false,
        confidence: "medium",
      });
    }
    return classified("miss", off, { existHit, missHit: true, waf: false, confidence: "medium" });
  }

  if (jsonAccountEvidence(input.body, input.account) && input.status >= 200 && input.status < 300) {
    return classified("found", `JSON body names account "${input.account}" (matcher recovered).`, {
      existHit: true,
      missHit: false,
      waf: false,
      confidence: "high",
    });
  }
  if (htmlAccountEvidence(input.body, input.account) && input.status >= 200 && input.status < 400) {
    return classified("found", `Profile page names account "${input.account}" (title/OG/username).`, {
      existHit: true,
      missHit: false,
      waf: false,
      confidence: "medium",
    });
  }

  if (input.status === 403) {
    if (absenceOnForbidden(input)) {
      return classified("miss", "HTTP 403 with a missing-profile body — miss, not a WAF block.", {
        existHit: false,
        missHit: true,
        waf: false,
        confidence: "medium",
      });
    }
    return classified("blocked", "HTTP 403 — treated as blocked (no missing-profile body), not a miss.", {
      existHit: false,
      missHit: false,
      waf: true,
      confidence: "medium",
    });
  }

  const { existHit, missHit } = dualCondition(spec, input.status, input.body);
  if (existHit && missHit) {
    const resolved = preferSpecificMatcher(spec, existHit, missHit, input.status);
    if (resolved) return resolved;
    if (isSoft404(input.body) || jsonErrorMissing(input.body) || jsonEmptyCollection(input.body)) {
      return classified("miss", "Exist+missing collision resolved as miss (soft-404 / empty / not-found JSON).", {
        existHit: false,
        missHit: true,
        waf: false,
        confidence: "high",
      });
    }
    return classified("escalate", "Both exist and missing conditions matched — ambiguous.", {
      existHit,
      missHit,
      waf: false,
      confidence: "low",
    });
  }
  if (existHit) {
    if (!spec.e_string && input.status >= 200 && input.status < 300) {
      if (isSoft404(input.body) || jsonErrorMissing(input.body) || jsonEmptyCollection(input.body)) {
        return classified("miss", "Soft-404: HTTP 200 but the body reads as a missing profile.", {
          existHit: false,
          missHit: true,
          waf: false,
          confidence: "high",
        });
      }
      // Empty exist-string (typical Sherlock status_code) is not proof of a profile.
      if (jsonAccountEvidence(input.body, input.account) || htmlAccountEvidence(input.body, input.account)) {
        return classified("found", `HTTP ${input.status} profile names "${input.account}" (empty e_string recovered).`, {
          existHit: true,
          missHit: false,
          waf: false,
          confidence: "medium",
        });
      }
      return classified(
        "escalate",
        `HTTP ${input.status} with an empty exist-string and no account evidence — not counted as found.`,
        { existHit: false, missHit: false, waf: false, confidence: "low" },
      );
    }
    return classified("found", `Exist match (status ${input.status}${spec.e_string ? ` + body` : ""}).`, {
      existHit,
      missHit,
      waf: false,
      confidence: spec.e_string ? "high" : "medium",
    });
  }
  if (missHit) {
    return classified("miss", `Missing match (status ${input.status}${spec.m_string ? ` + body` : ""}).`, {
      existHit,
      missHit,
      waf: false,
      confidence: "high",
    });
  }
  if (input.status === 200 && isSoft404(input.body)) {
    return classified("miss", "Soft-404 body on HTTP 200 — miss with reason, not a found.", {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if ((input.status === 404 || input.status === 410) && !existHit) {
    return classified(
      "miss",
      input.status === 410
        ? "HTTP 410 Gone — profile absent (missing-condition body did not need to match)."
        : "HTTP 404 — no profile (status indicates absence even if missing-string drifted).",
      { existHit: false, missHit: true, waf: false, confidence: "high" },
    );
  }
  if (input.status === 200 && jsonEmptyCollection(input.body) && spec.e_string && !existHit) {
    return classified("miss", "HTTP 200 with an empty JSON collection — no matching profile.", {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if (input.status === 204 && !existHit) {
    return classified("miss", "HTTP 204 No Content — no profile payload.", {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if (input.status === 401) {
    if (isSoft404(input.body) || jsonErrorMissing(input.body)) {
      return classified("miss", "HTTP 401 with a missing-profile body — miss, not an auth wall.", {
        existHit: false,
        missHit: true,
        waf: false,
        confidence: "medium",
      });
    }
    return classified("blocked", "HTTP 401 auth wall — treated as blocked, not a miss.", {
      existHit: false,
      missHit: false,
      waf: true,
      confidence: "medium",
    });
  }
  if (input.status === 400 && !existHit) {
    return classified("miss", "HTTP 400 — no profile payload (missing-condition body did not need to match).", {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "medium",
    });
  }
  if (jsonErrorMissing(input.body) && input.status >= 200 && input.status < 500 && !existHit) {
    return classified("miss", "JSON error payload reports the profile was not found.", {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "high",
    });
  }
  if (
    spec.e_string &&
    includesLoose(input.body, spec.e_string) &&
    input.status >= 200 &&
    input.status < 300 &&
    !isSoft404(input.body)
  ) {
    return classified(
      "found",
      `Exist body matched on HTTP ${input.status} (status code drifted from e_code ${spec.e_code}).`,
      { existHit: true, missHit: false, waf: false, confidence: "medium" },
    );
  }
  if (spec.m_string && includesLoose(input.body, spec.m_string) && !existHit) {
    return classified(
      "miss",
      `Missing body matched on HTTP ${input.status} (status code drifted from m_code ${spec.m_code}).`,
      { existHit: false, missHit: true, waf: false, confidence: "medium" },
    );
  }
  if (input.status >= 500) {
    return classified("error", `Upstream HTTP ${input.status}.`, { existHit, missHit, waf: false, confidence: "low" });
  }
  if (input.status === 406 || input.status === 999) {
    return classified("blocked", `HTTP ${input.status} — treated as blocked, not a miss.`, {
      existHit: false,
      missHit: false,
      waf: true,
      confidence: "medium",
    });
  }
  if (input.status >= 300 && input.status < 400) {
    return classified("miss", `HTTP ${input.status} redirect is not a /${input.account ?? "account"} profile.`, {
      existHit: false,
      missHit: true,
      waf: false,
      confidence: "medium",
    });
  }
  return classified("escalate", `Neither exist nor missing conditions matched (HTTP ${input.status}).`, {
    existHit,
    missHit,
    waf: false,
    confidence: "low",
  });
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
  try {
    const u = new URL(url);
    const lower = url.toLowerCase();
    const host = u.hostname.toLowerCase();
    return (
      host.startsWith("api.") ||
      host.includes(".api.") ||
      lower.includes("/api/") ||
      lower.includes("/api?") ||
      lower.endsWith(".json") ||
      lower.includes(".json?") ||
      lower.includes("format=json")
    );
  } catch {
    const lower = url.toLowerCase();
    return lower.includes("/api/") || lower.endsWith(".json");
  }
}
