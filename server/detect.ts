import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_REGEX,
  ROLE_LOCAL_PARTS,
} from "../shared/constants.ts";
import type { DetectedKind, PreflightResult, ScanMode } from "../shared/types.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const COMMON_TLDS = new Set([
  "com", "org", "net", "edu", "gov", "mil", "int", "io", "ai", "app", "dev",
  "co", "us", "uk", "de", "fr", "nl", "au", "ca", "jp", "cn", "ru", "br", "in",
  "info", "biz", "xyz", "me", "tv", "cc", "to", "sh", "so", "gg", "rs", "im",
  "cloud", "tech", "online", "site", "store", "blog", "news", "media", "pro",
  "name", "mobi", "asia", "jobs", "tel", "xxx", "aero", "museum", "coop",
  "gov.uk", "ac.uk", "co.uk", "org.uk", "com.au", "co.nz", "com.br",
]);

export function looksLikeEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

export function looksLikeDomain(raw: string): boolean {
  const q = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (IPV4_RE.test(q)) return true;
  if (!DOMAIN_RE.test(q)) return false;
  const labels = q.split(".");
  const tld = labels.slice(-1)[0];
  const sld = labels.slice(-2).join(".");
  if (COMMON_TLDS.has(sld) || COMMON_TLDS.has(tld)) return true;
  return tld.length >= 2 && labels.length >= 2;
}

export function detectKind(raw: string): DetectedKind {
  const q = raw.trim();
  if (looksLikeEmail(q)) return "mail";
  const hostish = q.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (hostish.includes(".") && looksLikeDomain(q)) return "host";
  return "handle";
}

export function resolveMode(raw: string, mode: ScanMode): DetectedKind {
  if (mode === "auto") return detectKind(raw);
  return mode;
}

export function normalizeQuery(raw: string, kind: DetectedKind): string {
  const q = raw.trim();
  if (kind === "mail") return q.toLowerCase();
  if (kind === "host") {
    return q
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/\.$/, "")
      .toLowerCase();
  }
  return q.replace(/^@/, "");
}

export function preflightHandle(
  handle: string,
  disposable: Set<string>,
): PreflightResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalized = handle.replace(/^@/, "");

  if (normalized.length < HANDLE_MIN || normalized.length > HANDLE_MAX) {
    errors.push(`Handle length must be ${HANDLE_MIN}–${HANDLE_MAX} characters.`);
  }
  if (!HANDLE_REGEX.test(normalized)) {
    errors.push("Handle may contain only letters, digits, dots, underscores, and hyphens.");
  }
  if (normalized.startsWith(".") || normalized.endsWith(".")) {
    errors.push("Handle cannot start or end with a dot.");
  }
  if (normalized.includes("..")) {
    errors.push("Handle cannot contain consecutive dots.");
  }
  if (normalized.length >= 3 && normalized.length <= 39) {
    notes.push("Length is inside the common GitHub/Twitter window (3–39).");
  }
  if (/^\d+$/.test(normalized)) {
    warnings.push("All-digit handles are rejected by many platforms.");
  }

  void disposable;
  return {
    ok: errors.length === 0,
    kind: "handle",
    query: handle,
    normalized,
    notes,
    warnings,
    errors,
  };
}

export function analyzeLocalPart(localPart: string) {
  const [baseRaw, plusTag] = localPart.split("+", 2);
  const base = baseRaw || localPart;
  const patterns: string[] = [];
  const possibleNames: string[] = [];
  let trailingYear: string | undefined;
  let trailingDigits: string | undefined;

  if (plusTag) patterns.push("plus-address");

  const digitSuffix = base.match(/(\d+)$/);
  if (digitSuffix) {
    trailingDigits = digitSuffix[1];
    patterns.push("trailing-digits");
  }
  const year = base.match(/(19|20)\d{2}$/);
  if (year) {
    trailingYear = year[0];
    patterns.push("trailing-year");
  }

  const stripped = base.replace(/\d+$/, "");
  const sep = stripped.includes(".") ? "." : stripped.includes("_") ? "_" : stripped.includes("-") ? "-" : "";
  if (sep) {
    patterns.push(sep === "." ? "dotted" : "separated");
    const parts = stripped.split(sep).filter(Boolean);
    if (parts.length === 2 && parts.every((p) => /^[a-z]+$/i.test(p))) {
      patterns.push(sep === "." ? "first.last" : sep === "_" ? "first_last" : "first-last");
      possibleNames.push(`${title(parts[0])} ${title(parts[1])}`);
    } else if (parts.length === 2 && /^[a-z]$/i.test(parts[0]) && /^[a-z]+$/i.test(parts[1])) {
      patterns.push("initial.last");
      possibleNames.push(`${title(parts[0])} ${title(parts[1])}`);
    }
  } else if (/^[a-z][a-z]+$/i.test(stripped) && stripped.length >= 6) {
    // flast: jsmith — too ambiguous to name, but flag the shape
    if (/^[a-z][a-z]{2,}$/i.test(stripped)) patterns.push("compact");
  }
  if (/^[a-z]\.?[a-z]+$/i.test(stripped)) {
    patterns.push("initial-last");
  }
  if (ROLE_LOCAL_PARTS.has(base.toLowerCase()) || ROLE_LOCAL_PARTS.has(stripped.toLowerCase())) {
    patterns.push("role");
  }

  return {
    localPart,
    plusTag,
    base,
    patterns: [...new Set(patterns)],
    possibleNames,
    trailingYear,
    trailingDigits,
  };
}

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function preflightMail(
  email: string,
  disposable: Set<string>,
  mxOk: boolean | null,
): PreflightResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalized = email.trim().toLowerCase();

  if (!EMAIL_RE.test(normalized)) {
    errors.push("Not a valid email address.");
    return {
      ok: false,
      kind: "mail",
      query: email,
      normalized,
      notes,
      warnings,
      errors,
    };
  }

  const [local, domain] = normalized.split("@");
  const analysis = analyzeLocalPart(local);
  if (disposable.has(domain)) {
    warnings.push(`Disposable / burn mailbox domain: ${domain}`);
  }
  if (analysis.plusTag) notes.push(`Plus-address tag: ${analysis.plusTag}`);
  if (ROLE_LOCAL_PARTS.has(analysis.base)) {
    warnings.push(`Role-based local-part (${analysis.base}) — often shared infrastructure.`);
  }
  if (mxOk === false) {
    warnings.push("No MX (or A/AAAA fallback) for the mail domain. Oracles may still run.");
  } else if (mxOk === true) {
    notes.push("MX present for the mail domain.");
  }

  return {
    ok: errors.length === 0,
    kind: "mail",
    query: email,
    normalized,
    notes,
    warnings,
    errors,
  };
}

export function preflightHost(domain: string): PreflightResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalized = normalizeQuery(domain, "host");

  if (IPV4_RE.test(normalized)) {
    notes.push("Literal IPv4 host — RDAP/DNS will be limited.");
  } else if (!DOMAIN_RE.test(normalized)) {
    errors.push("Not a resolvable-looking hostname.");
  }
  if (normalized.split(".").length > 6) {
    warnings.push("Unusually deep subdomain chain.");
  }

  return {
    ok: errors.length === 0,
    kind: "host",
    query: domain,
    normalized,
    notes,
    warnings,
    errors,
  };
}
