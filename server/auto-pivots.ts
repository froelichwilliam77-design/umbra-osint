import { HANDLE_REGEX, ROLE_LOCAL_PARTS } from "../shared/constants.ts";
import type { ScanProfile } from "../shared/scan-limits.ts";
import type { DetectedKind, LedgerRow, MailDossier, ScanMode, ScanSummary } from "../shared/types.ts";
import { envInt } from "./env-int.ts";
import { powerActive } from "./power.ts";
import { handleVariants, variantHandleCap, variantsEnabled } from "./variants.ts";

export interface PivotJob {
  query: string;
  mode: ScanMode;
  reason: string;
  profile: ScanProfile;
}

function envFlag(name: string, fallback = true): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v == null || v === "") return fallback;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return ["1", "true", "yes", "on"].includes(v);
}

export function autoPivotsEnabled(explicit?: boolean): boolean {
  if (explicit === false) return false;
  if (explicit === true) return true;
  return envFlag("UMBRA_AUTO_PIVOTS", true);
}

export function pivotMaxDepth(): number {
  return envInt("UMBRA_PIVOT_DEPTH", 1, 0, 2);
}

export function pivotJobCap(profile: ScanProfile, power?: boolean): number {
  const powered = power ?? powerActive(profile);
  const fallback = profile === "lean" ? 3 : powered ? 6 : 4;
  const max = profile === "lean" ? 4 : powered ? 8 : 6;
  return envInt("UMBRA_PIVOT_CAP", fallback, 0, max);
}

const PERSONAL_MAIL_DOMAINS = ["gmail.com", "proton.me", "outlook.com", "yahoo.com"];

function looksLikeHandle(value: string): boolean {
  const v = value.replace(/^@/, "").toLowerCase();
  return HANDLE_REGEX.test(v) && v.length >= 2 && v.length <= 39 && !ROLE_LOCAL_PARTS.has(v);
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function handleFromProfileUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (/github\.com|gitlab\.com|codeberg\.org|bitbucket\.org/.test(host) && parts[0]) {
      const h = parts[0].replace(/^@/, "");
      if (looksLikeHandle(h) && !["users", "u", "in", "user"].includes(h)) return h;
    }
    if (/twitter\.com|x\.com/.test(host) && parts[0] && looksLikeHandle(parts[0])) return parts[0];
    if (parts[0]?.startsWith("@") && looksLikeHandle(parts[0].slice(1))) return parts[0].slice(1);
    if (parts[0] === "u" && parts[1] && looksLikeHandle(parts[1])) return parts[1];
    if (parts[0] === "user" && parts[1] && looksLikeHandle(parts[1])) return parts[1];
    if (parts[0] === "users" && parts[1] && looksLikeHandle(parts[1])) return parts[1];
    if (parts[0] === "in" && parts[1] && looksLikeHandle(parts[1].replace(/\/$/, ""))) {
      return parts[1].replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Related handles from found profile metadata — not a second full map walk. */
export function relatedHandlesFromRows(rows: LedgerRow[], seed: string, cap = 2): string[] {
  const seedLc = seed.replace(/^@/, "").toLowerCase();
  const seen = new Set<string>([seedLc]);
  const out: string[] = [];
  for (const row of rows) {
    if (row.status !== "found") continue;
    const extra = row.metadata?.extra ?? {};
    const candidates = [
      extra.twitter_username,
      extra.login,
      extra.handle,
      row.metadata?.displayName,
      row.profileUrl ? handleFromProfileUrl(row.profileUrl) : undefined,
      row.url ? handleFromProfileUrl(row.url) : undefined,
    ];
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      const v = c.replace(/^@/, "").trim().toLowerCase();
      if (!looksLikeHandle(v) || seen.has(v)) continue;
      if (/\s/.test(c)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export function likelyEmailsFromHandle(handle: string, cap = 2): string[] {
  const h = handle.replace(/^@/, "").toLowerCase();
  if (!looksLikeHandle(h) || ROLE_LOCAL_PARTS.has(h)) return [];
  const local = h.replace(/[^a-z0-9._+-]/g, "");
  if (local.length < 3) return [];
  return PERSONAL_MAIL_DOMAINS.slice(0, cap).map((d) => `${local}@${d}`);
}

function pushJob(out: PivotJob[], seen: Set<string>, job: PivotJob, cap: number) {
  const key = `${job.mode}:${job.query.toLowerCase()}`;
  if (seen.has(key) || out.length >= cap) return;
  seen.add(key);
  out.push(job);
}

/**
 * High-value follow-ups after a finished scan. Depth/cap prevent recursion.
 * Variants themselves are probed in-scan; this only queues *other* identifiers.
 */
export function planAutoPivots(opts: {
  summary: ScanSummary;
  rows: LedgerRow[];
  autoPivots?: boolean;
  variants?: boolean;
  power?: boolean;
  seen?: Iterable<string>;
}): PivotJob[] {
  if (!autoPivotsEnabled(opts.autoPivots)) return [];
  const depth = opts.summary.pivotDepth ?? 0;
  if (depth >= pivotMaxDepth()) return [];
  const profile = opts.summary.profile ?? "lean";
  const cap = pivotJobCap(profile, opts.power);
  if (cap <= 0) return [];
  const seen = new Set<string>(opts.seen ?? []);
  seen.add(`${opts.summary.mode}:${opts.summary.query.toLowerCase()}`);
  const out: PivotJob[] = [];
  const mode = opts.summary.mode as DetectedKind;
  const pivotProfile: ScanProfile = profile === "full" ? "full" : "lean";

  if (mode === "mail") {
    const dossier = opts.summary.dossier as MailDossier | undefined;
    const handles = dossier?.pivots?.length
      ? dossier.pivots
      : [opts.summary.query.split("@")[0] ?? ""];
    for (const h of handles.slice(0, 2)) {
      if (!looksLikeHandle(h) && !HANDLE_REGEX.test(h)) continue;
      pushJob(
        out,
        seen,
        { query: h, mode: "handle", reason: `mail local-part → handle ${h}`, profile: "lean" },
        cap,
      );
    }
    if (dossier?.domain && (profile === "full" || opts.power)) {
      pushJob(
        out,
        seen,
        { query: dossier.domain, mode: "host", reason: `mail domain → host ${dossier.domain}`, profile: pivotProfile },
        cap,
      );
    }
  }

  if (mode === "handle") {
    const handle = opts.summary.query;
    const mailCap = profile === "lean" ? 1 : 2;
    for (const email of likelyEmailsFromHandle(handle, mailCap)) {
      pushJob(
        out,
        seen,
        { query: email, mode: "mail", reason: `handle → likely mailbox ${email}`, profile: "lean" },
        cap,
      );
    }
    const relatedCap = profile === "lean" ? 1 : 2;
    for (const h of relatedHandlesFromRows(opts.rows, handle, relatedCap)) {
      pushJob(
        out,
        seen,
        { query: h, mode: "handle", reason: `found profile metadata → handle ${h}`, profile: "lean" },
        cap,
      );
    }
    // Extra variant handles as lean scans only when they were not already in-scan.
    if (variantsEnabled(opts.variants) && profile === "full" && (opts.power || powerActive("full"))) {
      const already = new Set((opts.summary.variantList ?? []).map((v) => v.toLowerCase()));
      for (const v of handleVariants(handle, variantHandleCap(profile, opts.power))) {
        if (already.has(v)) continue;
        pushJob(
          out,
          seen,
          { query: v, mode: "handle", reason: `username variant ${v}`, profile: "lean" },
          cap,
        );
      }
    }
  }

  if (mode === "crawl") {
    const d = opts.summary.dossier as { usernames?: string[]; emails?: string[]; host?: string } | undefined;
    for (const u of (d?.usernames ?? []).slice(0, 2)) {
      if (!looksLikeHandle(u)) continue;
      pushJob(out, seen, { query: u, mode: "handle", reason: `crawl harvested handle ${u}`, profile: "lean" }, cap);
    }
    const email = d?.emails?.[0];
    if (email) {
      pushJob(out, seen, { query: email, mode: "mail", reason: `crawl harvested mail ${email}`, profile: "lean" }, cap);
    }
  }

  void hostFromUrl;
  return out;
}
