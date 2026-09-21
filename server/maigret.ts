import type { WmnSite } from "./schema.ts";
import { guessSherlockCategory, normalizeCheckKey } from "./sherlock.ts";

/** Maigret site record (subset used for dual-condition conversion). */
export interface MaigretSite {
  url?: string;
  urlMain?: string;
  urlProbe?: string;
  usernameClaimed?: string;
  usernameUnclaimed?: string;
  checkType?: string;
  absenceStrs?: string | string[];
  presenseStrs?: string | string[];
  presenceStrs?: string | string[];
  regexCheck?: string;
  disabled?: boolean;
  engine?: string;
  tags?: string[];
  type?: string;
  errors?: { httpCode?: number | number[] };
}

function firstStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.slice().sort((a, b) => b.length - a.length)[0] ?? "";
  return v ?? "";
}

function firstCode(v: number | number[] | undefined, fallback: number): number {
  if (Array.isArray(v)) return Number(v[0] ?? fallback);
  if (typeof v === "number") return v;
  return fallback;
}

function toAccountUrl(raw: string): string {
  return raw.replaceAll("{username}", "{account}").replaceAll("{}", "{account}");
}

export function maigretToWmn(name: string, site: MaigretSite): WmnSite | null {
  if (site.disabled) return null;
  const urlRaw = site.urlProbe || site.url;
  if (!urlRaw) return null;
  const url = toAccountUrl(urlRaw);
  if (!url.includes("{account}")) return null;
  const pretty = toAccountUrl(site.url || urlRaw);
  const tags = (site.tags ?? []).join(" ");
  const rec: WmnSite = {
    name,
    uri_check: url,
    uri_pretty: pretty,
    e_code: 200,
    e_string: firstStr(site.presenseStrs ?? site.presenceStrs),
    m_code: 404,
    m_string: firstStr(site.absenceStrs),
    cat: guessSherlockCategory(`${pretty} ${tags}`, name),
    source: "maigret",
  };
  if (site.regexCheck) rec.username_regex = site.regexCheck;
  if (site.usernameClaimed) rec.known = [site.usernameClaimed];

  const check = (site.checkType || "status_code").toLowerCase();
  if (check === "status_code") {
    rec.m_code = firstCode(site.errors?.httpCode, 404);
    if (!rec.m_string) rec.m_string = "";
  } else if (check === "message") {
    rec.m_code = 200;
    if (!rec.m_string) rec.m_string = firstStr(site.absenceStrs);
    if (!rec.e_string) rec.e_string = firstStr(site.presenseStrs ?? site.presenceStrs);
  } else if (check === "response_url") {
    rec.m_code = 302;
    rec.m_string = "";
  } else {
    return null;
  }
  return rec;
}

export function mergeMaigretSites(
  existing: WmnSite[],
  doc: Record<string, MaigretSite>,
): { sites: WmnSite[]; added: number; skipped: number } {
  const names = new Set(existing.map((s) => s.name.toLowerCase()));
  const keys = new Set(existing.map((s) => normalizeCheckKey(s.uri_check)));
  const extra: WmnSite[] = [];
  let skipped = 0;
  for (const [name, site] of Object.entries(doc)) {
    if (!site || name.startsWith("_") || name.startsWith("$")) {
      skipped += 1;
      continue;
    }
    const rec = maigretToWmn(name, site);
    if (!rec) {
      skipped += 1;
      continue;
    }
    const key = normalizeCheckKey(rec.uri_check);
    if (names.has(rec.name.toLowerCase()) || keys.has(key)) {
      skipped += 1;
      continue;
    }
    names.add(rec.name.toLowerCase());
    keys.add(key);
    extra.push(rec);
  }
  return { sites: extra, added: extra.length, skipped };
}
