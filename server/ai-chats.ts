import { AI_CHAT_DISCLAIMER } from "../shared/constants.ts";
import type { ScanProfile } from "../shared/scan-limits.ts";
import type { AiChatDossier, AiPublicShare, LedgerRow } from "../shared/types.ts";
import { HostPool, hostFromUrl } from "./concurrency.ts";
import { fetchPublic, jitter } from "./http.ts";
import { powerActive } from "./power.ts";

export { AI_CHAT_DISCLAIMER };

export interface AiSharePattern {
  product: string;
  /** Source-of-truth public share URL (no login required when the owner shared it). */
  re: RegExp;
}

export const AI_SHARE_PATTERNS: AiSharePattern[] = [
  { product: "ChatGPT", re: /https?:\/\/(?:chatgpt\.com|chat\.openai\.com)\/share\/(?:e\/)?[a-z0-9-]{8,}/gi },
  { product: "Claude", re: /https?:\/\/claude\.ai\/(?:share|public\/artifacts)\/[a-z0-9-]{8,}/gi },
  { product: "Perplexity", re: /https?:\/\/(?:www\.)?perplexity\.ai\/(?:search|page|collections)\/[a-z0-9-]{8,}/gi },
  { product: "Poe", re: /https?:\/\/poe\.com\/s\/[a-z0-9-]{6,}/gi },
  { product: "Character.AI", re: /https?:\/\/(?:www\.)?character\.ai\/(?:public-chat|chat)\/[a-z0-9-]{6,}/gi },
  { product: "HuggingChat", re: /https?:\/\/huggingface\.co\/chat\/(?:assistant|conversation)\/[a-z0-9-]{6,}/gi },
  { product: "Gemini", re: /https?:\/\/gemini\.google\.com\/share\/[a-zA-Z0-9_-]{8,}/gi },
  { product: "Grok", re: /https?:\/\/(?:grok\.com|x\.com)\/share\/[a-zA-Z0-9_-]{8,}/gi },
];

/** Silent account-exists oracles that are AI-chat signals — never private transcripts. */
export const AI_ACCOUNT_SIGNALS: Record<string, { product: string; primary: boolean }> = {
  openai: { product: "ChatGPT", primary: true },
  characterai: { product: "Character.AI", primary: true },
  huggingface: { product: "HuggingChat", primary: false },
  gmail: { product: "Gemini", primary: false },
  microsoft: { product: "Copilot", primary: false },
};

export function annotateAiOracle(
  spec: { id: string; handler: string },
  reason: string,
  extras: Partial<LedgerRow>,
): { reason: string; metadata?: LedgerRow["metadata"] } {
  const signal = AI_ACCOUNT_SIGNALS[spec.id] ?? AI_ACCOUNT_SIGNALS[spec.handler];
  if (!signal) return { reason, metadata: extras.metadata };
  const annotated = signal.primary
    ? `${AI_CHAT_DISCLAIMER} ${reason}`
    : `${reason} ${AI_CHAT_DISCLAIMER} ${signal.product} eligible.`;
  return {
    reason: annotated,
    metadata: {
      ...extras.metadata,
      extra: {
        ...(extras.metadata?.extra ?? {}),
        aiKind: "account-signal",
        product: signal.product,
        readable: false,
      },
    },
  };
}

export function aiKindChip(extra?: Record<string, string | number | boolean | null>): string | undefined {
  if (!extra) return undefined;
  if (extra.aiKind === "public-share") return extra.readable ? "public share" : "share gated";
  if (extra.aiKind === "account-signal") return "AI account";
  return undefined;
}

const LOGIN_WALL =
  /sign in to continue|log in to continue|create an account|auth0|please log in|login required|you need to sign in/i;

export function aiChatProbeCount(profile: ScanProfile, power?: boolean): number {
  const powered = power ?? powerActive(profile);
  if (profile === "lean") return 8;
  return powered ? 20 : 14;
}

export function aiSearchQueries(identifier: string, profile: ScanProfile): string[] {
  const q = identifier.trim();
  if (!q) return [];
  const quoted = `"${q}"`;
  const full = [
    `${quoted} site:chatgpt.com/share`,
    `${quoted} site:chat.openai.com/share`,
    `${quoted} site:claude.ai/share`,
    `${quoted} site:perplexity.ai/search OR site:perplexity.ai/page`,
    `${quoted} site:poe.com/s`,
    `${quoted} site:character.ai`,
    `${quoted} site:gemini.google.com/share`,
    `${quoted} site:huggingface.co/chat`,
  ];
  if (profile === "lean") return full.slice(0, 3);
  return full;
}

export function aiSearchLinks(identifier: string): { label: string; url: string }[] {
  const q = encodeURIComponent(`"${identifier.trim()}"`);
  return [
    { label: "ChatGPT shares (Google)", url: `https://www.google.com/search?q=${q}+site%3Achatgpt.com%2Fshare` },
    { label: "ChatGPT shares (DDG)", url: `https://duckduckgo.com/?q=${q}+site%3Achatgpt.com%2Fshare` },
    { label: "Claude shares (Google)", url: `https://www.google.com/search?q=${q}+site%3Aclaude.ai%2Fshare` },
    { label: "Perplexity (Google)", url: `https://www.google.com/search?q=${q}+site%3Aperplexity.ai` },
    { label: "Poe shares (Google)", url: `https://www.google.com/search?q=${q}+site%3Apoe.com%2Fs` },
    { label: "Character.AI (Google)", url: `https://www.google.com/search?q=${q}+site%3Acharacter.ai` },
    { label: "HuggingChat (Google)", url: `https://www.google.com/search?q=${q}+site%3Ahuggingface.co%2Fchat` },
    { label: "Gemini shares (Google)", url: `https://www.google.com/search?q=${q}+site%3Agemini.google.com%2Fshare` },
    { label: "Grok shares (Google)", url: `https://www.google.com/search?q=${q}+site%3Agrok.com%2Fshare` },
  ];
}

export function emptyAiChatDossier(identifier: string): AiChatDossier {
  return {
    disclaimer: AI_CHAT_DISCLAIMER,
    searchLinks: aiSearchLinks(identifier),
    publicShares: [],
  };
}

export function unwrapDuckDuckGoHref(href: string): string | undefined {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function extractHttpUrls(html: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s"'<>\\]+/gi;
  for (const m of html.match(re) ?? []) out.push(m.replace(/[.,);]+$/, ""));
  const hrefRe = /href=["']([^"']+)["']/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hrefRe.exec(html))) {
    const unwrapped = unwrapDuckDuckGoHref(hm[1]);
    if (unwrapped) out.push(unwrapped);
  }
  return out;
}

export function extractAiShareUrls(text: string): { product: string; url: string }[] {
  const found: { product: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const pat of AI_SHARE_PATTERNS) {
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
      found.push({ product: pat.product, url });
    }
  }
  return found;
}

export function isPublicAiSharePage(
  status: number,
  body: string,
  url: string,
): { readable: boolean; blocked: boolean; title?: string } {
  void url;
  if (status === 404 || status === 410 || status === 400) return { readable: false, blocked: false };
  if (status === 401 || status === 403 || status === 429 || status === 451) {
    return { readable: false, blocked: true };
  }
  const slice = body.slice(0, 12_000);
  const title = slice.match(/<title[^>]*>([^<]{1,180})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (status >= 200 && status < 400) {
    if (LOGIN_WALL.test(slice) && !/shared conversation|public (?:link|chat|thread)/i.test(slice)) {
      return { readable: false, blocked: true, title };
    }
    return { readable: true, blocked: false, title };
  }
  return { readable: false, blocked: true, title };
}

function identifierInText(text: string, identifier: string): boolean {
  const id = identifier.trim().toLowerCase();
  if (id.length < 3) return false;
  return text.toLowerCase().includes(id);
}

export function duckDuckGoHtmlUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

export async function runAiChatRecon(
  scanId: string,
  identifier: string,
  opts: {
    profile: ScanProfile;
    power?: boolean;
    mode: "mail" | "handle";
    onRow: (row: LedgerRow) => void;
    pool?: HostPool;
    /** Found-row excerpts / profile URLs — cheap pivot, no extra profile fetches. */
    seedText?: string;
  },
): Promise<AiPublicShare[]> {
  const queries = aiSearchQueries(identifier, opts.profile);
  const verifyCap = opts.profile === "lean" ? 4 : opts.power ? 12 : 8;
  const pool = opts.pool ?? new HostPool({ global: 2, perHost: 1 });
  const discovered: { product: string; url: string }[] = [];
  const seen = new Set<string>();

  const take = (hits: { product: string; url: string }[]) => {
    for (const hit of hits) {
      const key = hit.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      discovered.push(hit);
    }
  };

  if (opts.seedText) take(extractAiShareUrls(opts.seedText));

  await Promise.all(
    queries.map((query) =>
      pool.schedule("duckduckgo.com", async () => {
        if (pool.isAborted) return;
        await jitter(80, 240);
        const url = duckDuckGoHtmlUrl(query);
        const res = await fetchPublic({ url, timeoutMs: 10_000 });
        if (res.status !== 200 || pool.isAborted) return;
        const hrefs = extractHttpUrls(res.body);
        take(extractAiShareUrls(`${hrefs.join("\n")}\n${res.body}`));
      }),
    ),
  );

  const shares: AiPublicShare[] = [];
  for (const hit of discovered.slice(0, verifyCap)) {
    if (pool.isAborted) break;
    await pool.schedule(hostFromUrl(hit.url), async () => {
      if (pool.isAborted) return;
      await jitter(60, 180);
      const res = await fetchPublic({ url: hit.url, timeoutMs: 10_000 });
      const verdict = isPublicAiSharePage(res.status, res.body, hit.url);
      const linked = identifierInText(res.body.slice(0, 8_000), identifier);
      if (!verdict.readable) {
        if (verdict.blocked) {
          opts.onRow({
            id: `${scanId}:ai-share:${hit.url}`,
            scanId,
            mode: opts.mode,
            target: identifier,
            site: `${hit.product} public share`,
            category: "ai",
            status: "blocked",
            reason: `${AI_CHAT_DISCLAIMER} Share URL found via public search but the page is not openly readable (login/WAF).`,
            url: hit.url,
            profileUrl: hit.url,
            method: "GET",
            httpStatus: res.status,
            latencyMs: res.latencyMs,
            confidence: "low",
            metadata: { extra: { aiKind: "public-share", product: hit.product, readable: false } },
          });
        }
        return;
      }
      shares.push({
        product: hit.product,
        url: hit.url,
        readable: true,
        title: verdict.title,
      });
      opts.onRow({
        id: `${scanId}:ai-share:${hit.url}`,
        scanId,
        mode: opts.mode,
        target: identifier,
        site: `${hit.product} public share`,
        category: "ai",
        status: "found",
        reason: linked
          ? `${AI_CHAT_DISCLAIMER} Public share page is open to read. Identifier appears on the page.`
          : `${AI_CHAT_DISCLAIMER} Public share URL discovered via web search for this identifier. Page is open to read — not proof of mailbox ownership.`,
        url: hit.url,
        profileUrl: hit.url,
        method: "GET",
        httpStatus: res.status,
        latencyMs: res.latencyMs,
        confidence: linked ? "medium" : "low",
        metadata: {
          displayName: verdict.title,
          extra: { aiKind: "public-share", product: hit.product, readable: true, linked },
        },
      });
    });
  }

  return shares;
}
