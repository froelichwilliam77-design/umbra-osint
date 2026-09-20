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

const EXTRA_KEYS = [
  "login",
  "html_url",
  "company",
  "blog",
  "twitter_username",
  "public_repos",
  "public_gists",
  "created_at",
  "updated_at",
  "id",
  "karma",
  "title",
  "url",
];

function extrasFrom(data: unknown): Record<string, string | number | boolean | null> | undefined {
  const rec = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  if (!rec) return undefined;
  const extra: Record<string, string | number | boolean | null> = {};
  for (const key of EXTRA_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) extra[key] = v.trim();
    else if (typeof v === "number" && Number.isFinite(v)) extra[key] = v;
    else if (typeof v === "boolean") extra[key] = v;
  }
  return Object.keys(extra).length ? extra : undefined;
}

function cardFilled(card: MetadataCard): boolean {
  return Boolean(
    card.displayName ||
      card.avatarUrl ||
      card.bio ||
      card.followers != null ||
      card.location ||
      card.website ||
      (card.extra && Object.keys(card.extra).length),
  );
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
    extra: extrasFrom(data),
  };
  if (!cardFilled(card)) return undefined;
  return card;
}

function metaTag(body: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${key}["']`, "i"),
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

export function htmlTitle(body: string): string | undefined {
  const m = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}

export function extractJsonLd(body: string): MetadataCard | undefined {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    try {
      const parsed = JSON.parse(match[1]!) as unknown;
      const nodes = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { "@graph"?: unknown[] })["@graph"])
          ? (parsed as { "@graph": unknown[] })["@graph"]
          : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const n = node as Record<string, unknown>;
        const type = String(n["@type"] ?? "").toLowerCase();
        if (!/person|profilepage|organization/.test(type) && !n.name) continue;
        const img = n.image;
        const avatar =
          typeof img === "string"
            ? img
            : img && typeof img === "object"
              ? asString((img as { url?: unknown }).url)
              : undefined;
        const card: MetadataCard = {
          displayName: asString(n.name),
          bio: asString(n.description),
          avatarUrl: avatar,
          website: asString(n.url),
        };
        if (cardFilled(card)) return card;
      }
    } catch {
      /* skip broken JSON-LD blocks */
    }
  }
  return undefined;
}

export function extractHtmlMeta(body: string): MetadataCard | undefined {
  if (!body.includes("<") || body.trim().startsWith("{")) return undefined;
  const ld = extractJsonLd(body);
  const displayName =
    metaTag(body, "og:title") || metaTag(body, "twitter:title") || metaTag(body, "profile:username") || htmlTitle(body);
  const bio =
    metaTag(body, "og:description") || metaTag(body, "twitter:description") || metaTag(body, "description");
  const avatarUrl = metaTag(body, "og:image") || metaTag(body, "twitter:image") || metaTag(body, "og:image:url");
  const website = metaTag(body, "og:url") || metaTag(body, "canonical");
  const card: MetadataCard = { displayName, bio, avatarUrl, website };
  if (ld) {
    return {
      displayName: ld.displayName || card.displayName,
      bio: ld.bio || card.bio,
      avatarUrl: ld.avatarUrl || card.avatarUrl,
      website: ld.website || card.website,
      extra: ld.extra,
    };
  }
  if (!displayName && !avatarUrl && !bio) return undefined;
  return card;
}

export function extractMetadata(
  siteName: string,
  body: string,
  extractors: ExtractorSpec[],
): MetadataCard | undefined {
  const spec = extractors.find((e) => e.site === siteName);
  if (spec) {
    if (spec.kind === "html") {
      return extractHtmlMeta(body) ?? tryGenericJson(body);
    }
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
    const nested =
      asRecord(src.user) ||
      asRecord(src.profile) ||
      asRecord(src.data) ||
      (Array.isArray(src.data) ? asRecord(src.data[0]) : undefined);
    const obj = nested && !asString(src.name) && !asString(src.login) ? nested : src;
    const card: MetadataCard = {
      displayName: asString(obj.name ?? obj.display_name ?? obj.displayName ?? obj.login ?? obj.username ?? obj.handle),
      avatarUrl: asString(
        obj.avatar_url ?? obj.avatarUrl ?? obj.avatar ?? obj.icon_img ?? obj.profile_image ?? obj.picture,
      ),
      bio: asString(obj.bio ?? obj.description ?? obj.about ?? obj.summary ?? obj.note),
      followers: asNumber(
        obj.followers ?? obj.followers_count ?? obj.followersCount ?? obj.karma ?? obj.nb_followers,
      ),
      following: asNumber(obj.following ?? obj.following_count ?? obj.followsCount),
      location: asString(obj.location ?? obj.country ?? obj.city),
      website: asString(obj.blog ?? obj.website ?? obj.url ?? obj.html_url),
      extra: extrasFrom(obj),
    };
    if (!cardFilled(card)) return undefined;
    return card;
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}
