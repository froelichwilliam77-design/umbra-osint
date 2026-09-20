import type { MetadataCard } from "../shared/types.ts";
import type { ExtractorSpec } from "./schema.ts";

function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function applySpec(data: unknown, spec: ExtractorSpec): MetadataCard | undefined {
  const card: MetadataCard = {
    displayName: asString(getPath(data, spec.displayName ?? "")),
    avatarUrl: asString(getPath(data, spec.avatar ?? "")),
    bio: asString(getPath(data, spec.bio ?? "")),
    followers: asNumber(getPath(data, spec.followers ?? "")),
    following: asNumber(getPath(data, spec.following ?? "")),
    location: asString(getPath(data, spec.location ?? "")),
    website: asString(getPath(data, spec.website ?? "")),
  };
  const extra: Record<string, string | number | boolean | null> = {};
  if (asString(getPath(data, "html_url"))) extra.html_url = asString(getPath(data, "html_url"))!;
  if (asString(getPath(data, "login"))) extra.login = asString(getPath(data, "login"))!;
  card.extra = Object.keys(extra).length ? extra : undefined;
  if (
    !card.displayName &&
    !card.avatarUrl &&
    !card.bio &&
    card.followers == null &&
    !card.location
  ) {
    return undefined;
  }
  return card;
}

function metaTag(body: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m?.[1]) return decodeHtml(m[1]).trim();
  }
  return undefined;
}

function decodeHtml(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function extractHtmlMeta(body: string): MetadataCard | undefined {
  if (!body.includes("<") || body.trim().startsWith("{")) return undefined;
  const displayName = metaTag(body, "og:title") || metaTag(body, "twitter:title") || htmlTitle(body);
  const bio = metaTag(body, "og:description") || metaTag(body, "twitter:description") || metaTag(body, "description");
  const avatarUrl = metaTag(body, "og:image") || metaTag(body, "twitter:image");
  const website = metaTag(body, "og:url");
  if (!displayName && !avatarUrl && !bio) return undefined;
  return { displayName, bio, avatarUrl, website };
}

export function extractMetadata(
  siteName: string,
  body: string,
  extractors: ExtractorSpec[],
): MetadataCard | undefined {
  const spec = extractors.find((e) => e.site === siteName);
  if (spec) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (spec.kind === "json-first" && Array.isArray(parsed)) {
        return applySpec(parsed[0], spec) ?? tryGenericJson(body) ?? extractHtmlMeta(body);
      }
      return applySpec(parsed, spec) ?? tryGenericJson(body) ?? extractHtmlMeta(body);
    } catch {
      return extractHtmlMeta(body);
    }
  }
  return tryGenericJson(body) ?? extractHtmlMeta(body);
}

function tryGenericJson(body: string): MetadataCard | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const src = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown> | undefined) : parsed;
    if (!src || typeof src !== "object") return undefined;
    const card: MetadataCard = {
      displayName: asString(src.name ?? src.display_name ?? src.login ?? src.username),
      avatarUrl: asString(src.avatar_url ?? src.avatar ?? src.icon_img ?? src.profile_image),
      bio: asString(src.bio ?? src.description ?? src.about),
      followers: asNumber(src.followers ?? src.followers_count ?? src.karma),
      location: asString(src.location),
      website: asString(src.blog ?? src.website ?? src.url),
    };
    if (!card.displayName && !card.avatarUrl && !card.bio) return undefined;
    return card;
  } catch {
    return undefined;
  }
}

export function htmlTitle(body: string): string | undefined {
  const m = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}
