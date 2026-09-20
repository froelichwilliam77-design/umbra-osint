/** Bounded HTML harvest for the STRAND-style spider — no cheerio, regex only. */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HREF_RE = /(?:href|src|action)=["']([^"']{1,2000})["']/gi;
const SRCSET_RE = /srcset=["']([^"']+)["']/gi;
const ABS_URL_RE = /https?:\/\/[^\s"'<>\\]{4,500}/gi;
const HANDLE_AT_RE = /(?:^|[\s"'(:>=])@([A-Za-z0-9._-]{2,39})(?=$|[\s"'<),])/g;
const SKIP_SCHEMES = /^(javascript|data|blob|about|file|mailto|tel|sms|#)/i;
const BINARY_EXT =
  /\.(?:pdf|zip|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|mp3|gz|tgz|exe|dmg|bin|wasm|mp4)(?:$|\?)/i;

const PROFILE_PATHS: { host: RegExp; re: RegExp }[] = [
  { host: /(?:^|\.)github\.com$/i, re: /^\/([A-Za-z0-9._-]{1,39})(?:\/|$)/ },
  { host: /(?:^|\.)(?:twitter|x)\.com$/i, re: /^\/([A-Za-z0-9_]{1,15})(?:\/|$)/ },
  { host: /(?:^|\.)instagram\.com$/i, re: /^\/([A-Za-z0-9._]{1,30})(?:\/|$)/ },
  { host: /(?:^|\.)reddit\.com$/i, re: /^\/(?:u|user)\/([A-Za-z0-9_-]{1,20})(?:\/|$)/ },
  { host: /(?:^|\.)linkedin\.com$/i, re: /^\/in\/([A-Za-z0-9_-]{2,100})(?:\/|$)/ },
  { host: /(?:^|\.)gitlab\.com$/i, re: /^\/([A-Za-z0-9._-]{1,64})(?:\/|$)/ },
];

const SKIP_HANDLES = new Set([
  "http",
  "https",
  "www",
  "com",
  "org",
  "net",
  "html",
  "index",
  "home",
  "about",
  "login",
  "signup",
  "static",
  "assets",
  "images",
  "css",
  "js",
  "api",
  "docs",
]);

export interface CrawlExtraction {
  links: string[];
  emails: string[];
  usernames: string[];
  title?: string;
}

export function isBinaryUrl(url: string): boolean {
  return BINARY_EXT.test(url.split("#")[0] ?? url);
}

export function resolveCrawlUrl(raw: string, base: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || SKIP_SCHEMES.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    url.hash = "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function harvestEmails(text: string, emails: string[]): void {
  EMAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMAIL_RE.exec(text))) {
    const v = m[0].toLowerCase();
    if (v.endsWith(".png") || v.endsWith(".jpg") || v.includes("example.com")) continue;
    emails.push(v);
  }
}

function harvestAtHandles(text: string, usernames: string[]): void {
  HANDLE_AT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HANDLE_AT_RE.exec(text))) {
    const h = m[1] ?? "";
    if (SKIP_HANDLES.has(h.toLowerCase()) || h.includes(".")) continue;
    usernames.push(h);
  }
}

function harvestProfileUser(url: string, usernames: string[]): void {
  try {
    const parsed = new URL(url);
    for (const spec of PROFILE_PATHS) {
      if (!spec.host.test(parsed.hostname)) continue;
      const m = parsed.pathname.match(spec.re);
      const h = m?.[1];
      if (h && !SKIP_HANDLES.has(h.toLowerCase())) usernames.push(h);
    }
  } catch {
    /* ignore */
  }
}

export function extractCrawlBody(body: string, baseUrl: string): CrawlExtraction {
  const links: string[] = [];
  const emails: string[] = [];
  const usernames: string[] = [];

  HREF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HREF_RE.exec(body))) {
    const raw = m[1] ?? "";
    if (raw.toLowerCase().startsWith("mailto:")) {
      const email = raw.slice(7).split("?")[0];
      if (email) emails.push(email.toLowerCase());
      continue;
    }
    const abs = resolveCrawlUrl(raw, baseUrl);
    if (abs) {
      links.push(abs);
      harvestProfileUser(abs, usernames);
    }
  }

  SRCSET_RE.lastIndex = 0;
  while ((m = SRCSET_RE.exec(body))) {
    for (const part of (m[1] ?? "").split(",")) {
      const abs = resolveCrawlUrl(part.trim().split(/\s+/)[0] ?? "", baseUrl);
      if (abs) links.push(abs);
    }
  }

  ABS_URL_RE.lastIndex = 0;
  while ((m = ABS_URL_RE.exec(body))) {
    const abs = resolveCrawlUrl(m[0].replace(/[),.;]+$/, ""), baseUrl);
    if (abs) {
      links.push(abs);
      harvestProfileUser(abs, usernames);
    }
  }

  const title = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  harvestEmails(body, emails);
  harvestAtHandles(body.replace(/<[^>]+>/g, " "), usernames);

  return {
    links: unique(links).slice(0, 400),
    emails: unique(emails).slice(0, 80),
    usernames: unique(usernames).slice(0, 80),
    title,
  };
}

export function parseSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const v = (m[1] ?? "").trim();
    if (v) locs.push(v);
  }
  return unique(locs);
}
