import type { CrawlDossier, LedgerRow } from "../shared/types.ts";
import type { ScanProfile } from "../shared/scan-limits.ts";
import { HostPool } from "./concurrency.ts";
import { extractCrawlBody, isBinaryUrl, parseSitemapLocs, resolveCrawlUrl, sameOrigin } from "./crawl-extract.ts";
import { htmlTitle } from "./extract.ts";
import { fetchFollow } from "./http.ts";
import { crawlPageCap } from "./limits.ts";
import { powerActive } from "./power.ts";
import { assertSafeUrl } from "./ssrf.ts";

const INTERESTING_HEADERS = [
  "server",
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-powered-by",
  "alt-svc",
];

export function crawlLedgerBudget(profile?: ScanProfile): number {
  return crawlPageCap(profile) + 48;
}

function rowId(scanId: string, kind: string, key: string): string {
  return `${scanId}:${kind}:${key.slice(0, 96)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runCrawlScan(
  scanId: string,
  seedRaw: string,
  opts: {
    workers: number;
    perHost: number;
    profile?: ScanProfile;
    onRow: (row: LedgerRow) => void;
    onDossier?: (d: CrawlDossier) => void;
    onPool?: (pool: HostPool) => void;
    shouldAbort?: () => boolean;
  },
): Promise<void> {
  const seedUrl = assertSafeUrl(seedRaw.startsWith("http") ? seedRaw : `https://${seedRaw}`);
  const origin = seedUrl.origin;
  const host = seedUrl.hostname;
  const maxPages = crawlPageCap(opts.profile);
  const dossier: CrawlDossier = {
    kind: "crawl",
    seed: seedUrl.href,
    origin,
    host,
    pages: 0,
    skipped: 0,
    blocked: 0,
    emails: [],
    usernames: [],
    links: [],
    headers: {},
    maxPages,
    scope: "same-origin",
  };
  opts.onDossier?.(dossier);

  const seen = new Set<string>();
  const queue: string[] = [];
  const foundEmail = new Set<string>();
  const foundUser = new Set<string>();
  let inFlight = 0;
  let headerRows = false;

  const enqueue = (raw: string) => {
    const abs = resolveCrawlUrl(raw, origin);
    if (!abs) return;
    if (seen.has(abs)) return;
    if (!sameOrigin(abs, origin)) return;
    if (isBinaryUrl(abs)) return;
    try {
      assertSafeUrl(abs);
    } catch {
      dossier.blocked += 1;
      return;
    }
    seen.add(abs);
    queue.push(abs);
  };

  enqueue(seedUrl.href);
  enqueue(new URL("/robots.txt", origin).href);
  enqueue(new URL("/sitemap.xml", origin).href);
  enqueue(new URL("/.well-known/security.txt", origin).href);

  const workers = Math.max(1, Math.min(powerActive(opts.profile) ? 4 : 2, opts.workers));
  const pool = new HostPool({ global: workers, perHost: 1 });
  opts.onPool?.(pool);

  const emitIntel = (kind: "email" | "username", value: string, source: string) => {
    if (kind === "email") {
      if (foundEmail.has(value)) return;
      foundEmail.add(value);
      dossier.emails.push(value);
      opts.onRow({
        id: rowId(scanId, "email", value),
        scanId,
        mode: "crawl",
        target: seedUrl.href,
        site: `email:${value}`,
        category: "identity",
        status: "found",
        reason: `Harvested from ${source}`,
        url: source,
        method: "GET",
        metadata: { extra: { email: value } },
      });
      return;
    }
    if (foundUser.has(value.toLowerCase())) return;
    foundUser.add(value.toLowerCase());
    dossier.usernames.push(value);
    opts.onRow({
      id: rowId(scanId, "user", value),
      scanId,
      mode: "crawl",
      target: seedUrl.href,
      site: `@${value}`,
      category: "identity",
      status: "found",
      reason: `Username harvested from ${source}`,
      url: source,
      method: "GET",
      metadata: { extra: { username: value } },
    });
  };

  const probe = async (url: string) => {
    const res = await fetchFollow({ url, method: "GET", timeoutMs: 10_000 });
    if (res.ssrf) {
      dossier.blocked += 1;
      opts.onRow({
        id: rowId(scanId, "ssrf", url),
        scanId,
        mode: "crawl",
        target: seedUrl.href,
        site: new URL(url).pathname || "/",
        category: "crawl",
        status: "invalid",
        reason: "SSRF blocked",
        url,
        method: "GET",
      });
      return;
    }
    if (res.error && res.status === 0) {
      dossier.skipped += 1;
      opts.onRow({
        id: rowId(scanId, "err", url),
        scanId,
        mode: "crawl",
        target: seedUrl.href,
        site: new URL(url).pathname || "/",
        category: "crawl",
        status: "error",
        reason: res.error,
        url,
        method: "GET",
        latencyMs: res.latencyMs,
      });
      return;
    }
    dossier.pages += 1;
    if (!headerRows) {
      headerRows = true;
      dossier.headers = {};
      for (const h of INTERESTING_HEADERS) {
        const v = res.headers[h];
        if (v) dossier.headers[h] = v;
      }
      dossier.title = htmlTitle(res.body);
      for (const [k, v] of Object.entries(dossier.headers)) {
        opts.onRow({
          id: rowId(scanId, "hdr", k),
          scanId,
          mode: "crawl",
          target: seedUrl.href,
          site: `header:${k}`,
          category: "tls",
          status: "found",
          reason: v.slice(0, 280),
          url: seedUrl.href,
          method: "GET",
        });
      }
    }
    const ok = res.status >= 200 && res.status < 400;
    const path = (() => {
      try {
        return new URL(res.finalUrl || url).pathname || "/";
      } catch {
        return url;
      }
    })();
    opts.onRow({
      id: rowId(scanId, "page", url),
      scanId,
      mode: "crawl",
      target: seedUrl.href,
      site: path,
      category: "crawl",
      status: ok ? "found" : res.status === 404 ? "miss" : res.status === 403 || res.status === 429 ? "blocked" : "error",
      reason: `${res.status} ${res.headers["content-type"]?.split(";")[0] ?? ""}`.trim(),
      url,
      finalUrl: res.finalUrl,
      httpStatus: res.status,
      method: "GET",
      latencyMs: res.latencyMs,
      metadata: { displayName: htmlTitle(res.body), extra: { server: res.headers.server ?? "" } },
    });
    const ctype = res.headers["content-type"] ?? "";
    if (!ok || !res.body) return;
    if (/xml/i.test(ctype) || /sitemap/i.test(url)) {
      for (const loc of parseSitemapLocs(res.body)) enqueue(loc);
    }
    const extracted = extractCrawlBody(res.body, res.finalUrl || url);
    for (const email of extracted.emails) emitIntel("email", email, url);
    for (const user of extracted.usernames) emitIntel("username", user, url);
    for (const link of extracted.links) {
      if (sameOrigin(link, origin)) {
        enqueue(link);
        if (!dossier.links.includes(link) && dossier.links.length < 200) dossier.links.push(link);
      }
    }
    opts.onDossier?.(dossier);
  };

  const worker = async () => {
    while (!opts.shouldAbort?.() && !pool.isAborted && dossier.pages < maxPages) {
      const url = queue.shift();
      if (!url) {
        if (inFlight === 0) return;
        await sleep(20);
        continue;
      }
      inFlight += 1;
      try {
        await pool.schedule(host, () => probe(url));
      } catch {
        /* aborted / memory */
      } finally {
        inFlight -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  opts.onDossier?.(dossier);
}
