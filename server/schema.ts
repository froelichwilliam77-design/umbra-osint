import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { SchemaStats } from "../shared/types.ts";

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
}

export interface SchemaBundle {
  sites: WmnSite[];
  extractors: ExtractorSpec[];
  oracles: OracleSpec[];
  disposable: Set<string>;
  wmnImportedAt?: string;
  wmnSource: string;
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
    byName.set(site.name, site);
  }
  for (const site of curated.sites ?? []) {
    byName.set(site.name, site);
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
    wmnSource: "schema/wmn-data.json (WhatsMyName)",
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
    disposableDomains: s.disposable.size,
    wmnImportedAt: s.wmnImportedAt,
    wmnSource: s.wmnSource,
  };
}

export function sitesForScan(includeNsfw: boolean): WmnSite[] {
  const sites = loadSchema().sites;
  if (includeNsfw) return sites;
  return sites.filter((s) => (s.cat || "").toLowerCase() !== "xx nsfw xx");
}

export function categoryOf(site: WmnSite): string {
  const cat = (site.cat || "misc").toLowerCase();
  return cat === "xx nsfw xx" ? "nsfw" : cat;
}
