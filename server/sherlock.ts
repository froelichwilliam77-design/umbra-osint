import type { WmnSite } from "./schema.ts";

export interface SherlockSite {
  url?: string;
  urlMain?: string;
  urlProbe?: string;
  errorType?: string;
  errorMsg?: string | string[];
  errorCode?: number | number[];
  errorUrl?: string;
  regexCheck?: string;
  username_claimed?: string;
  request_method?: string;
  request_payload?: unknown;
}

const CAT_HOST: [string, string][] = [
  ["github", "coding"],
  ["gitlab", "coding"],
  ["codeberg", "coding"],
  ["bitbucket", "coding"],
  ["sourceforge", "coding"],
  ["npmjs", "coding"],
  ["pypi", "coding"],
  ["rubygems", "coding"],
  ["docker", "coding"],
  ["huggingface", "coding"],
  ["steam", "gaming"],
  ["xbox", "gaming"],
  ["playstation", "gaming"],
  ["twitch", "gaming"],
  ["roblox", "gaming"],
  ["chess", "gaming"],
  ["lichess", "gaming"],
  ["osu.ppy", "gaming"],
  ["spotify", "music"],
  ["soundcloud", "music"],
  ["last.fm", "music"],
  ["bandcamp", "music"],
  ["discogs", "music"],
  ["youtube", "video"],
  ["vimeo", "video"],
  ["dailymotion", "video"],
  ["flickr", "images"],
  ["imgur", "images"],
  ["unsplash", "images"],
  ["medium", "blog"],
  ["substack", "blog"],
  ["tumblr", "blog"],
  ["wordpress", "blog"],
  ["hashnode", "blog"],
  ["dev.to", "blog"],
  ["linkedin", "business"],
  ["producthunt", "business"],
];

export function guessSherlockCategory(url: string, name: string): string {
  const hay = `${url} ${name}`.toLowerCase();
  if (/(porn|xxx|onlyfans|adult)/i.test(hay)) return "xx NSFW xx";
  for (const [needle, cat] of CAT_HOST) {
    if (hay.includes(needle)) return cat;
  }
  return "social";
}

export function normalizeCheckKey(uri: string): string {
  try {
    const withPlaceholder = uri.replaceAll("{account}", "{}").replaceAll("%7Baccount%7D", "{}");
    const u = new URL(withPlaceholder);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.toLowerCase().replaceAll("{}", "{account}");
    return `${host}${path}`;
  } catch {
    return uri.toLowerCase();
  }
}

function firstErrorCode(code: number | number[] | undefined): number {
  if (Array.isArray(code)) return Number(code[0] ?? 404);
  if (typeof code === "number") return code;
  return 404;
}

function firstErrorMsg(msg: string | string[] | undefined): string {
  if (Array.isArray(msg)) {
    return msg.slice().sort((a, b) => b.length - a.length)[0] ?? "";
  }
  return msg ?? "";
}

export function sherlockToWmn(name: string, site: SherlockSite): WmnSite | null {
  const urlRaw = site.urlProbe || site.url;
  if (!urlRaw) return null;
  const url = urlRaw.replaceAll("{}", "{account}");
  const pretty = (site.url || urlRaw).replaceAll("{}", "{account}");
  const rec: WmnSite = {
    name,
    uri_check: url,
    uri_pretty: pretty,
    e_code: 200,
    e_string: "",
    m_code: 404,
    m_string: "",
    cat: guessSherlockCategory(pretty, name),
    source: "sherlock",
  };
  if (site.regexCheck) rec.username_regex = site.regexCheck;
  if (site.username_claimed) rec.known = [site.username_claimed];
  const method = String(site.request_method || "GET").toUpperCase();
  if (method === "POST" && site.request_payload != null) {
    rec.post_body = JSON.stringify(site.request_payload).replaceAll("{}", "{account}");
    rec.headers = { "Content-Type": "application/json" };
  }
  if (site.errorType === "status_code") {
    rec.m_code = firstErrorCode(site.errorCode);
    rec.m_string = "";
    rec.e_code = rec.m_code === 200 ? 200 : 200;
  } else if (site.errorType === "message") {
    rec.m_code = 200;
    rec.m_string = firstErrorMsg(site.errorMsg);
  } else if (site.errorType === "response_url") {
    rec.m_code = 302;
    rec.m_string = "";
    rec.errorUrl = site.errorUrl;
  } else {
    return null;
  }
  return rec;
}

export function mergeSherlockSites(
  existing: WmnSite[],
  sherlockDoc: Record<string, SherlockSite>,
): { sites: WmnSite[]; added: number; skipped: number } {
  const names = new Set(existing.map((s) => s.name.toLowerCase()));
  const keys = new Set(existing.map((s) => normalizeCheckKey(s.uri_check)));
  const extra: WmnSite[] = [];
  let skipped = 0;
  for (const [name, site] of Object.entries(sherlockDoc)) {
    if (name.startsWith("$")) {
      skipped += 1;
      continue;
    }
    const rec = sherlockToWmn(name, site);
    if (!rec) {
      skipped += 1;
      continue;
    }
    if (names.has(rec.name.toLowerCase()) || keys.has(normalizeCheckKey(rec.uri_check))) {
      skipped += 1;
      continue;
    }
    names.add(rec.name.toLowerCase());
    keys.add(normalizeCheckKey(rec.uri_check));
    extra.push(rec);
  }
  return { sites: extra, added: extra.length, skipped };
}
