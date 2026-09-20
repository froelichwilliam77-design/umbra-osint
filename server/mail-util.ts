import { createHash } from "node:crypto";
import { analyzeLocalPart } from "./detect.ts";
import { fetchPublic } from "./http.ts";

export function md5(s: string): string {
  return createHash("md5").update(s.trim().toLowerCase()).digest("hex");
}

export function sha256Email(s: string): string {
  return createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
}

export function mailPivots(email: string): string[] {
  const [local] = email.trim().toLowerCase().split("@");
  const analysis = analyzeLocalPart(local);
  const out = new Set<string>();
  if (analysis.base) out.add(analysis.base);
  if (analysis.plusTag && analysis.base) out.add(analysis.base);
  const stripped = analysis.base.replace(/(19|20)\d{2}$/, "");
  if (stripped && stripped !== analysis.base) out.add(stripped);
  for (const name of analysis.possibleNames) {
    const parts = name.toLowerCase().split(/\s+/);
    if (parts.length === 2) {
      out.add(parts.join(""));
      out.add(parts.join("."));
      out.add(parts.join("_"));
    }
  }
  return [...out].filter((h) => /^[A-Za-z0-9._-]{2,39}$/.test(h));
}

export async function gravatarProfile(email: string) {
  const hash = md5(email);
  const sha256 = sha256Email(email);
  const res = await fetchPublic({
    url: `https://en.gravatar.com/${hash}.json`,
    accept: "application/json",
  });
  if (res.status === 404) {
    return { exists: false as const, hash, sha256 };
  }
  if (res.status !== 200) {
    return { exists: false as const, hash, sha256, error: res.error ?? `HTTP ${res.status}` };
  }
  try {
    const json = JSON.parse(res.body) as {
      entry?: {
        displayName?: string;
        thumbnailUrl?: string;
        profileUrl?: string;
        accounts?: { shortname: string; url: string }[];
      }[];
    };
    const entry = json.entry?.[0];
    return {
      exists: true as const,
      hash,
      sha256,
      profileUrl: entry?.profileUrl ?? `https://gravatar.com/${hash}`,
      displayName: entry?.displayName,
      avatarUrl: entry?.thumbnailUrl,
      accounts: entry?.accounts?.map((a) => ({ shortname: a.shortname, url: a.url })),
    };
  } catch {
    return { exists: true as const, hash, sha256, profileUrl: `https://gravatar.com/${hash}` };
  }
}
