import type { HttpResponse } from "./http.ts";

const REDDIT_HOST = /(?:^|\.)reddit\.com$/i;
const BLOCK_BODY = /whoa there|pardner|just a moment|attention required|captcha|checking your browser/i;

export function isRedditHost(hostOrUrl: string): boolean {
  const raw = hostOrUrl.trim();
  if (!raw) return false;
  try {
    const host = raw.includes("://") ? new URL(raw).hostname : raw;
    return REDDIT_HOST.test(host);
  } catch {
    return REDDIT_HOST.test(raw);
  }
}

/** www ↔ old.reddit.com — old is often less WAF-gated on undici (1 GB, no TLS). */
export function redditAlternateUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!REDDIT_HOST.test(u.hostname)) return undefined;
    if (u.hostname.toLowerCase().startsWith("old.")) {
      u.hostname = u.hostname.replace(/^old\./i, "www.");
    } else {
      u.hostname = u.hostname.replace(/^(www\.)?/i, "old.");
    }
    return u.href;
  } catch {
    return undefined;
  }
}

export function redditNeedsRetry(res: Pick<HttpResponse, "status" | "body">): boolean {
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) return true;
  if (res.status === 0) return true;
  return BLOCK_BODY.test(res.body.slice(0, 4_000));
}

export function isRedditProfileJson(body: string, account?: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const rec = JSON.parse(trimmed) as { kind?: unknown; data?: { name?: unknown } };
    if (rec.kind !== "t2" || !rec.data || typeof rec.data !== "object") return false;
    if (!account) return true;
    return String(rec.data.name ?? "").toLowerCase() === account.replace(/^u\//i, "").toLowerCase();
  } catch {
    return false;
  }
}
