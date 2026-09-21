import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { FAST_TIER_SIZE, LEAN_SITE_CAP, type ScanProfile } from "../shared/scan-limits.ts";
import type { SchemaStats } from "../shared/types.ts";
import { fastTierSize, leanSiteCap } from "./limits.ts";
import { selectMailOracles } from "./mail-priority.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface WmnSite {
  name: string;
  uri_check: string;
  uri_pretty?: string;
  e_code: number;
  e_string: string;
  m_code: number;
  m_string: string;
  cat: string;
  known?: string[];
  protection?: string[];
  headers?: Record<string, string>;
  post_body?: string;
  strip_bad_char?: string;
  valid?: boolean;
  username_regex?: string;
  source?: string;
  errorUrl?: string;
}

export interface ExtractorSpec {
  site: string;
  kind: "json" | "json-first" | "html";
  avatar?: string;
  bio?: string;
  followers?: string;
  following?: string;
  displayName?: string;
  location?: string;
  website?: string;
}

export interface OracleSpec {
  id: string;
  name: string;
  category: string;
  handler: string;
  optional?: boolean;
  /** When set, the oracle is not probed — emitted as blocked with this reason. */
  quarantine?: string | boolean;
}

export interface SchemaBundle {
  sites: WmnSite[];
  extractors: ExtractorSpec[];
  oracles: OracleSpec[];
  disposable: Set<string>;
  wmnImportedAt?: string;
  wmnSource: string;
  wmnSites: number;
  sherlockSites: number;
  curatedSites: number;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), "utf8")) as T;
}

function loadYaml<T>(rel: string): T {
  return parseYaml(readFileSync(join(root, rel), "utf8")) as T;
}

let cache: SchemaBundle | undefined;

export function loadSchema(): SchemaBundle {
  if (cache) return cache;
  const wmn = loadJson<{ sites: WmnSite[] }>("schema/wmn-data.json");
  const curated = loadYaml<{
    sites?: WmnSite[];
    extractors?: ExtractorSpec[];
    overrides?: { name: string; username_regex?: string; e_string?: string; m_string?: string }[];
  }>("schema/sites.curated.yaml");
  const oraclesDoc = loadYaml<{ oracles: OracleSpec[] }>("schema/oracles.yaml");
  const disposable = new Set(
    readFileSync(join(root, "schema/disposable-domains.txt"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#")),
  );

  const byName = new Map<string, WmnSite>();
  for (const site of wmn.sites ?? []) {
    if (site.valid === false) continue;
    if (!site.uri_check || !site.name) continue;
    byName.set(site.name, { ...site, source: site.source ?? "wmn" });
  }
  let sherlock: { sites?: WmnSite[] } = { sites: [] };
  try {
    sherlock = loadJson<{ sites?: WmnSite[] }>("schema/sherlock-overlay.json");
  } catch {
    sherlock = { sites: [] };
  }
  for (const site of sherlock.sites ?? []) {
    if (!site?.name || !site.uri_check) continue;
    if (byName.has(site.name)) continue;
    byName.set(site.name, { ...site, source: site.source ?? "sherlock" });
  }
  for (const site of curated.sites ?? []) {
    byName.set(site.name, { ...site, source: "curated" });
  }
  for (const ov of curated.overrides ?? []) {
    const cur = byName.get(ov.name);
    if (!cur) continue;
    byName.set(ov.name, { ...cur, ...ov });
  }

  let wmnImportedAt: string | undefined;
  try {
    wmnImportedAt = statSync(join(root, "schema/wmn-data.json")).mtime.toISOString();
  } catch {
    /* ignore */
  }

  cache = {
    sites: [...byName.values()],
    extractors: curated.extractors ?? [],
    oracles: oraclesDoc.oracles ?? [],
    disposable,
    wmnImportedAt,
    wmnSource: "schema/wmn-data.json (WhatsMyName) + schema/sherlock-overlay.json",
    wmnSites: (wmn.sites ?? []).length,
    sherlockSites: (sherlock.sites ?? []).length,
    curatedSites: (curated.sites ?? []).length,
  };
  return cache;
}

export function reloadSchema(): SchemaBundle {
  cache = undefined;
  return loadSchema();
}

export function importWmnPayload(payload: unknown): { imported: number } {
  const doc = payload as { sites?: WmnSite[] };
  if (!doc?.sites || !Array.isArray(doc.sites)) {
    throw new Error("WhatsMyName JSON must contain a sites array.");
  }
  const current = loadSchema();
  const byName = new Map(current.sites.map((s) => [s.name, s]));
  let imported = 0;
  for (const site of doc.sites) {
    if (!site?.name || !site.uri_check) continue;
    byName.set(site.name, site);
    imported += 1;
  }
  current.sites = [...byName.values()];
  current.wmnImportedAt = new Date().toISOString();
  current.wmnSource = "runtime import";
  return { imported };
}

export function schemaStats(): SchemaStats {
  const s = loadSchema();
  const categories: Record<string, number> = {};
  for (const site of s.sites) {
    const cat = site.cat || "misc";
    categories[cat] = (categories[cat] ?? 0) + 1;
  }
  return {
    handleSites: s.sites.length,
    categories,
    oracles: s.oracles.length,
    oraclesQuarantined: s.oracles.filter((o) => Boolean(o.quarantine)).length,
    oraclesLean: selectMailOracles(s.oracles, { profile: "lean" }).length,
    disposableDomains: s.disposable.size,
    wmnImportedAt: s.wmnImportedAt,
    wmnSource: s.wmnSource,
    wmnSites: s.wmnSites,
    sherlockSites: s.sherlockSites,
    curatedSites: s.curatedSites,
    leanSites: sitesForScan(false, { profile: "lean" }).length,
  };
}

const HIGH_SIGNAL =
  /\b(github|gitlab|gitea|gitee|bitbucket|codeberg|sourcehut|sourceforge|launchpad|stackoverflow|stack overflow|hacker news|hackerone|keybase|wikipedia|reddit|youtube|twitch|discord|telegram|mastodon|bluesky|medium|pinterest|steam|spotify|soundcloud|bandcamp|last\.fm|npm|crates|pypi|rubygems|packagist|huggingface|kaggle|replit|docker|gravatar|flickr|tumblr|wordpress|patreon|substack|hashnode|dev\.to|behance|dribbble|artstation|deviantart|vimeo|npmjs|dockerhub|docker hub|lichess|chess\.com|duolingo|strava|goodreads|letterboxd|producthunt|product hunt|buymeacoffee|ko-fi|kofi|gumroad|figma|canva|notion|slack|atlassian|trello|jira)\b/i;

/** WAF/CAPTCHA-gated handle modules that rarely yield found on lean (no TLS children). */
const CHRONIC_BLOCKED_HANDLES =
  /\b(twitter|x\.com|instagram|facebook|tiktok|snapchat|threads|onlyfans|linkedin|vkontakte|vk\.com|ok\.ru|weibo|xiaohongshu)\b/i;

export function isClearnetSite(site: WmnSite): boolean {
  return !/\.onion\b/i.test(site.uri_check || "");
}

export function isHighSignalSite(site: WmnSite): boolean {
  return HIGH_SIGNAL.test(site.name) || HIGH_SIGNAL.test(site.uri_check || "");
}

export function looksLikeApiCheck(site: WmnSite): boolean {
  return /\/api[\.\/]|api\.|about\.json|lookup\.json|users\?|format=json/i.test(site.uri_check || "");
}

export function isChronicBlockedHandle(site: WmnSite): boolean {
  const blob = `${site.name} ${site.uri_check || ""}`;
  if (CHRONIC_BLOCKED_HANDLES.test(blob)) return true;
  if (site.protection?.length && !looksLikeApiCheck(site) && !isHighSignalSite(site)) return true;
  return false;
}

export function siteRank(site: WmnSite): number {
  let score = 0;
  if (site.source === "curated") score += 100;
  const cat = (site.cat || "").toLowerCase();
  if (cat === "social") score += 40;
  else if (cat === "coding") score += 42;
  else if (cat === "tech") score += 32;
  else if (cat === "business") score += 16;
  else if (cat === "xx nsfw xx") score -= 80;
  if (isHighSignalSite(site)) score += 70;
  if (looksLikeApiCheck(site)) score += 22;
  if (site.known?.length) score += 10;
  if (!site.protection?.length) score += 16;
  else score -= 28;
  if (isChronicBlockedHandle(site)) score -= 55;
  return score;
}

export function rankSites(sites: WmnSite[]): WmnSite[] {
  return [...sites].sort((a, b) => siteRank(b) - siteRank(a) || a.name.localeCompare(b.name));
}

export function splitFastTier(sites: WmnSite[], n?: number): { fast: WmnSite[]; rest: WmnSite[] } {
  const cap = n ?? fastTierSize() ?? FAST_TIER_SIZE;
  return { fast: sites.slice(0, cap), rest: sites.slice(cap) };
}

export function sitesForScan(
  includeNsfw: boolean,
  opts?: { profile?: ScanProfile; cap?: number },
): WmnSite[] {
  let sites = loadSchema().sites.filter(isClearnetSite);
  if (!includeNsfw) sites = sites.filter((s) => (s.cat || "").toLowerCase() !== "xx nsfw xx");
  const ranked = rankSites(sites);
  const profile = opts?.profile ?? "full";
  if (profile !== "lean") return ranked;
  const cap = opts?.cap ?? leanSiteCap() ?? LEAN_SITE_CAP;
  return ranked.filter((s) => !isChronicBlockedHandle(s) || looksLikeApiCheck(s)).slice(0, cap);
}

export function categoryOf(site: WmnSite): string {
  const cat = (site.cat || "misc").toLowerCase();
  return cat === "xx nsfw xx" ? "nsfw" : cat;
}
