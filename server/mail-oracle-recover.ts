import type { OracleVerdict } from "./oracles.ts";
import type { HttpResponse } from "./http.ts";
import { detectWaf } from "./classify.ts";
import { matchTakenPhrases } from "./mail-oracle-match.ts";

const AVAILABLE_PHRASES = [
  "is available",
  "email is available",
  "address is available",
  "not registered",
  "no account",
  "doesn't exist",
  "does not exist",
  "we couldn't find",
  "couldn't find your",
  "could not find",
  "no user found",
  "user not found",
  "email not found",
  "unknown email",
  "isn't registered",
  "is not registered",
  "hasn't been registered",
  "has not been registered",
  "you can use this email",
  "looks good",
  "you're good to go",
  "you are good to go",
];

const CSRF_HINTS = [
  "csrf token mismatch",
  "invalid csrf",
  "csrf failed",
  "missing csrf",
  "authenticity token",
  "invalid authenticity",
  "xsrf",
  "forbidden (csrf)",
];

const SESSION_HINTS = [
  "please log in",
  "please sign in",
  "sign in to continue",
  "login required",
  "not authenticated",
  "unauthenticated",
  "authorization required",
];

const EXISTS_TRUE_KEYS = [
  "exists",
  "exist",
  "registered",
  "taken",
  "found",
  "email_exists",
  "emailexists",
  "emailExists",
  "account_exists",
  "accountExists",
  "user_exists",
  "userExists",
  "has_account",
  "hasAccount",
  "has_user",
  "in_use",
  "inUse",
  "is_registered",
  "isRegistered",
  "already_registered",
  "alreadyRegistered",
  "is_taken",
  "isTaken",
];

const AVAILABLE_TRUE_KEYS = [
  "available",
  "isAvailable",
  "is_available",
  "email_available",
  "emailAvailable",
  "unused",
  "is_unused",
  "free",
  "isFree",
  "valid_new",
  "canRegister",
  "can_register",
];

function asRec(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function boolish(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return undefined;
}

function flagAt(rec: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const direct = boolish(rec[key]);
    if (direct !== undefined) return direct;
  }
  return undefined;
}

function walkFlags(j: unknown, keys: string[], depth = 0): boolean | undefined {
  const rec = asRec(j);
  if (!rec || depth > 3) return undefined;
  const hit = flagAt(rec, keys);
  if (hit !== undefined) return hit;
  for (const nested of [rec.data, rec.result, rec.payload, rec.user, rec.account, rec.response, rec.body]) {
    const inner = walkFlags(nested, keys, depth + 1);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

export function parseMaybeJson(body: string): unknown | undefined {
  const t = body.trim().replace(/^\uFEFF/, "").replace(/^\)\]\}',?\s*/, "");
  if (!t) return undefined;
  const candidates = [t];
  const obj = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (obj?.[1] && obj[1] !== t) candidates.push(obj[1]);
  for (const c of candidates) {
    if (!(c.startsWith("{") || c.startsWith("["))) continue;
    try {
      return JSON.parse(c) as unknown;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function matchAvailablePhrases(body: string): OracleVerdict | null {
  const lower = body.toLowerCase();
  if (AVAILABLE_PHRASES.some((p) => lower.includes(p)) && !/already|taken|in use|registered with/i.test(lower)) {
    return { status: "miss", reason: "Signup/availability copy reports the email is unused." };
  }
  return null;
}

export function interpretGenericJson(j: unknown): OracleVerdict | null {
  const rec = asRec(j);
  const blob = JSON.stringify(j).toLowerCase();
  if (/email_already_registered|email_is_taken|email_sharing_limit|already_registered|alreadyinuse|already_in_use/.test(blob)) {
    return { status: "found", reason: "JSON error code reports the email is already registered." };
  }
  const exists = walkFlags(j, EXISTS_TRUE_KEYS);
  if (exists === true) return { status: "found", reason: "JSON existence flag is true." };
  if (exists === false) return { status: "miss", reason: "JSON existence flag is false." };
  const available = walkFlags(j, AVAILABLE_TRUE_KEYS);
  if (available === true) return { status: "miss", reason: "JSON availability flag is true." };
  if (available === false) return { status: "found", reason: "JSON availability flag is false (taken)." };
  if (rec) {
    const status = String(rec.status ?? rec.state ?? rec.result ?? "").toLowerCase();
    if (["unavailable", "taken", "exists", "used", "registered", "conflict"].includes(status)) {
      return { status: "found", reason: `JSON status=${status}.` };
    }
    if (["available", "ok", "free", "success", "valid", "unused"].includes(status) && !/already|taken/.test(blob)) {
      return { status: "miss", reason: `JSON status=${status}.` };
    }
    const users = rec.users ?? rec.items ?? rec.accounts;
    if (Array.isArray(users)) {
      return users.length > 0
        ? { status: "found", reason: "JSON collection returned a matching account." }
        : { status: "miss", reason: "JSON collection was empty." };
    }
  }
  if (Array.isArray(j)) {
    return j.length > 0
      ? { status: "found", reason: "JSON array returned a matching account." }
      : { status: "miss", reason: "JSON array was empty." };
  }
  return null;
}

function looksLikeSignupHtml(body: string): boolean {
  const lower = body.slice(0, 24_000).toLowerCase();
  if (!/<form[\s>]/.test(lower) && !/type=["']email["']/.test(lower) && !/<html/i.test(body)) return false;
  return /sign\s*up|register|create (an )?account|join now|email/.test(lower);
}

function redirectHint(res: HttpResponse): OracleVerdict | null {
  const dest = (res.location || res.finalUrl || "").toLowerCase();
  if (!dest) return null;
  if (res.status < 300 || res.status >= 400) return null;
  if (/password|welcome|dashboard|account\/home|onboarding/.test(dest)) {
    return { status: "found", reason: `Redirect to ${res.location ?? res.finalUrl} looks like an existing-account flow.` };
  }
  if (/login|signin|sign-in|signup|sign-up|register|join|auth/.test(dest)) {
    return { status: "miss", reason: `Redirect to ${res.location ?? res.finalUrl} is a login/signup surface, not a taken-email signal.` };
  }
  return null;
}

/**
 * Convert unclassified oracle HTTP into found / miss / blocked with a reason.
 * Called after handler-specific matchers fail so escalate is a last resort.
 */
export function recoverOracleVerdict(res: HttpResponse): OracleVerdict | null {
  if (res.ssrf) return null;
  if (res.error && res.status === 0) return null;
  const waf = detectWaf({ status: res.status, body: res.body, headers: res.headers });
  if (waf) return { status: "blocked", reason: waf };

  const taken = matchTakenPhrases(res.body);
  if (taken) return taken;

  const json = parseMaybeJson(res.body);
  if (json !== undefined) {
    const fromJson = interpretGenericJson(json);
    if (fromJson) return fromJson;
  }

  const available = matchAvailablePhrases(res.body);
  if (available) return available;

  const lower = res.body.toLowerCase();
  if (CSRF_HINTS.some((h) => lower.includes(h)) || res.status === 419) {
    return { status: "blocked", reason: "Endpoint requires a session/CSRF token — blocked, not a miss." };
  }
  if (res.status === 401 || (res.status === 403 && SESSION_HINTS.some((h) => lower.includes(h)))) {
    return { status: "blocked", reason: `Auth wall (HTTP ${res.status}) — not a miss.` };
  }

  const redirected = redirectHint(res);
  if (redirected) return redirected;
  if (res.status >= 300 && res.status < 400) {
    return { status: "miss", reason: `HTTP ${res.status} redirect without a taken-email signal.` };
  }

  if (res.status === 404 || res.status === 410) {
    return { status: "miss", reason: `HTTP ${res.status} — oracle reports no account.` };
  }
  if (res.status === 405 || res.status === 501) {
    return { status: "blocked", reason: `HTTP ${res.status} method not allowed — endpoint not usable as a silent oracle.` };
  }
  if (res.status === 412 || res.status === 418) {
    return { status: "blocked", reason: `HTTP ${res.status} — treated as blocked (CSRF/bot), not a miss.` };
  }
  if (res.status === 204 || (res.status === 200 && !res.body.trim())) {
    return { status: "miss", reason: "Empty success body — oracle did not report the email as taken." };
  }
  if (res.status === 409 || res.status === 422) {
    return { status: "found", reason: `HTTP ${res.status} conflict/unprocessable is a taken-email signal.` };
  }
  if (res.status === 400) {
    return { status: "miss", reason: "HTTP 400 validation without a taken-email phrase — unused or rejected." };
  }
  if (res.status >= 500) return null;

  if (res.status >= 200 && res.status < 300 && looksLikeSignupHtml(res.body)) {
    return { status: "miss", reason: "Signup/login HTML did not flag the email as taken." };
  }
  if (res.status >= 200 && res.status < 300 && json !== undefined && asRec(json) && Object.keys(asRec(json)!).length === 0) {
    return { status: "miss", reason: "Empty JSON object — oracle did not report the email as taken." };
  }
  return null;
}

export function finalizeOracleVerdict(res: HttpResponse, verdict: OracleVerdict): OracleVerdict {
  if (verdict.status !== "escalate") return verdict;
  return recoverOracleVerdict(res) ?? verdict;
}
