import type { ScanProfile } from "../shared/scan-limits.ts";
import type { LedgerRow, PasteDossier, PasteHit } from "../shared/types.ts";
import { duckDuckGoHtmlUrl, extractHttpUrls, unwrapDuckDuckGoHref } from "./ai-chats.ts";
import { HostPool, hostFromUrl } from "./concurrency.ts";
import { fetchPublic, jitter } from "./http.ts";
import { powerActive } from "./power.ts";

export const PASTE_DISCLAIMER =
  "Public paste search only — Google/DDG dorks plus GET-verify of open paste URLs. No paid dark-web markets.";

export interface PastePattern {
  site: string;
  re: RegExp;
}

export const PASTE_PATTERNS: PastePattern[] = [
  { site: "Pastebin", re: /https?:\/\/(?:www\.)?pastebin\.com\/(?:raw\/)?[A-Za-z0-9]{5,12}/gi },
  { site: "GitHub Gist", re: /https?:\/\/gist\.github\.com\/[A-Za-z0-9_.-]+\/[a-f0-9]{8,}/gi },
  { site: "rentry", re: /https?:\/\/(?:www\.)?rentry\.(?:co|org)\/[A-Za-z0-9_-]{3,}/gi },
  { site: "dpaste", re: /https?:\/\/dpaste\.(?:org|com)\/[A-Za-z0-9]{4,}/gi },
  { site: "paste.ee", re: /https?:\/\/paste\.ee\/(?:p\/)?[A-Za-z0-9]{4,}/gi },
  { site: "ControlC", re: /https?:\/\/(?:www\.)?controlc\.com\/[A-Za-z0-9]{6,}/gi },
  { site: "justpaste.it", re: /https?:\/\/justpaste\.it\/[A-Za-z0-9]{3,}/gi },
  { site: "Ghostbin", re: /https?:\/\/ghostbin\.(?:com|co)\/paste\/[A-Za-z0-9]+/gi },
];

export function pasteSearchQueries(identifier: string, profile: ScanProfile): string[] {
  const q = identifier.trim();
  if (!q) return [];
  const quoted = `"${q}"`;
  const full = [
    `${quoted} site:pastebin.com`,
    `${quoted} site:gist.github.com`,
    `${quoted} site:rentry.co OR site:rentry.org`,
    `${quoted} site:dpaste.org OR site:paste.ee`,
    `${quoted} (pastebin OR ghostbin OR rentry OR dpaste)`,
  ];
  return profile === "lean" ? full.slice(0, 2) : full;
}

export function pasteSearchLinks(identifier: string): { label: string; url: string }[] {
  const q = encodeURIComponent(`"${identifier.trim()}"`);
  const raw = encodeURIComponent(identifier.trim());
  return [
    { label: "Google pastes", url: `https://www.google.com/search?q=${q}+(pastebin|ghostbin|rentry|dpaste|paste)` },
    { label: "DDG pastes", url: `https://duckduckgo.com/?q=${q}+(pastebin|rentry|dpaste|gist)` },
    { label: "Pastebin search", url: `https://www.google.com/search?q=${q}+site%3Apastebin.com` },
    { label: "GitHub gists", url: `https://gist.github.com/search?q=${raw}` },
    { label: "GitHub code", url: `https://github.com/search?q=${raw}&type=code` },
  ];
}

export function emptyPasteDossier(identifier: string): PasteDossier {
  return {
    disclaimer: PASTE_DISCLAIMER,
    searchLinks: pasteSearchLinks(identifier),
    hits: [],
  };
}

export function extractPasteUrls(text: string): { site: string; url: string }[] {
  const found: { site: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const pat of PASTE_PATTERNS) {
    pat.re.lastIndex = 0;
    for (const m of text.match(pat.re) ?? []) {
      let url = m.replace(/[.,);]+$/, "");
      try {
        const u = new URL(url);
        u.hash = "";
        url = u.origin + u.pathname.replace(/\/+$/, "");
      } catch {
        continue;
      }
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ site: pat.site, url });
    }
  }
  void unwrapDuckDuckGoHref;
  return found;
}

export function pasteProbeCount(profile: ScanProfile, power?: boolean): number {
  const powered = power ?? powerActive(profile);
  if (profile === "lean") return 4;
  return powered ? 12 : 8;
}

function identifierInText(text: string, identifier: string): boolean {
  const id = identifier.trim().toLowerCase();
  if (id.length < 3) return false;
  return text.toLowerCase().includes(id);
}

export async function runPasteRecon(
  scanId: string,
  identifier: string,
  opts: {
    profile: ScanProfile;
    power?: boolean;
    mode: "mail" | "handle";
    onRow: (row: LedgerRow) => void;
    pool?: HostPool;
    seedText?: string;
  },
): Promise<PasteHit[]> {
  const queries = pasteSearchQueries(identifier, opts.profile);
  const verifyCap = opts.profile === "lean" ? 3 : opts.power ? 10 : 6;
  const pool = opts.pool ?? new HostPool({ global: 2, perHost: 1 });
  const discovered: { site: string; url: string }[] = [];
  const seen = new Set<string>();

  const take = (hits: { site: string; url: string }[]) => {
    for (const hit of hits) {
      const key = hit.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      discovered.push(hit);
    }
  };

  if (opts.seedText) take(extractPasteUrls(opts.seedText));

  await Promise.all(
    queries.map((query) =>
      pool.schedule("duckduckgo.com", async () => {
        if (pool.isAborted) return;
        await jitter(80, 240);
        const url = duckDuckGoHtmlUrl(query);
        const res = await fetchPublic({ url, timeoutMs: 10_000 });
        if (res.status !== 200 || pool.isAborted) return;
        const hrefs = extractHttpUrls(res.body);
        take(extractPasteUrls(`${hrefs.join("\n")}\n${res.body}`));
      }),
    ),
  );

  const hits: PasteHit[] = [];
  for (const hit of discovered.slice(0, verifyCap)) {
    if (pool.isAborted) break;
    await pool.schedule(hostFromUrl(hit.url), async () => {
      if (pool.isAborted) return;
      await jitter(60, 180);
      const res = await fetchPublic({ url: hit.url, timeoutMs: 10_000 });
      if (res.status === 404 || res.status === 410) return;
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451) {
        opts.onRow({
          id: `${scanId}:paste:${hit.url}`,
          scanId,
          mode: opts.mode,
          target: identifier,
          site: `${hit.site} paste`,
          category: "search",
          status: "blocked",
          reason: `${PASTE_DISCLAIMER} Paste URL found via public search but the page is not openly readable.`,
          url: hit.url,
          profileUrl: hit.url,
          method: "GET",
          httpStatus: res.status,
          latencyMs: res.latencyMs,
          confidence: "low",
        });
        return;
      }
      if (res.status < 200 || res.status >= 400) return;
      const slice = res.body.slice(0, 8_000);
      const linked = identifierInText(slice, identifier);
      const title = slice.match(/<title[^>]*>([^<]{1,180})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
      const pasteHit: PasteHit = {
        site: hit.site,
        url: hit.url,
        title,
        snippet: slice.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
        confidence: linked ? "medium" : "low",
      };
      hits.push(pasteHit);
      opts.onRow({
        id: `${scanId}:paste:${hit.url}`,
        scanId,
        mode: opts.mode,
        target: identifier,
        site: `${hit.site} paste`,
        category: "search",
        status: "found",
        reason: linked
          ? `${PASTE_DISCLAIMER} Public paste page is open and mentions this identifier.`
          : `${PASTE_DISCLAIMER} Public paste URL discovered via web search. Open page — not proof of ownership.`,
        url: hit.url,
        profileUrl: hit.url,
        method: "GET",
        httpStatus: res.status,
        latencyMs: res.latencyMs,
        confidence: pasteHit.confidence,
        metadata: { displayName: title, extra: { paste: true, linked } },
        bodyExcerpt: pasteHit.snippet,
      });
    });
  }

  return hits;
}
