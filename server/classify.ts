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
  "doesn't exist",
  "does not exist",
  "no such user",
  "couldn't find",
  "could not find",
  "sorry, this page isn't available",
  "this page isn't available",
  "the page you were looking for doesn't exist",
];

function headerMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

function includesLoose(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function detectWaf(input: Pick<ClassifyInput, "status" | "body" | "headers">): string | null {
  if (input.status === 403) return "HTTP 403 — treated as blocked, not a miss.";
  if (input.status === 429) return "HTTP 429 rate limit — treated as blocked, not a miss.";
  const headers = headerMap(input.headers);
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
    if (path.includes(`/${acc}`) || path.endsWith(`/${acc}`) || url.search.toLowerCase().includes(acc)) {
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
