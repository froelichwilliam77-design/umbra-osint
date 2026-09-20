import { createHash } from "node:crypto";
import { analyzeLocalPart } from "./detect.ts";
import { fetchPublic } from "./http.ts";

export function md5(s: string): string {
  return createHash("md5").update(s.trim().toLowerCase()).digest("hex");
}

export function sha256Email(s: string): string {
  return createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
}

const HANDLE_OK = /^[A-Za-z0-9._-]{2,39}$/;

function add(out: Set<string>, value: string | undefined) {
  if (!value) return;
  const v = value.replace(/^@/, "").toLowerCase();
  if (HANDLE_OK.test(v)) out.add(v);
}

/** Local-part → likely handles. Never invents names that aren't in the address. */
export function mailPivots(email: string): string[] {
  const [local] = email.trim().toLowerCase().split("@");
  const analysis = analyzeLocalPart(local);
  const out = new Set<string>();
  add(out, analysis.base);
  add(out, local);
  const stripped = analysis.base.replace(/\d+$/, "");
  add(out, stripped);

  for (const name of analysis.possibleNames) {
    const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) continue;
    const [first, last] = parts;
    add(out, first + last);
    add(out, `${first}.${last}`);
    add(out, `${first}_${last}`);
    add(out, `${first}-${last}`);
    add(out, first[0] + last);
    add(out, first + last[0]);
    add(out, `${last}.${first}`);
    add(out, last + first);
    add(out, first);
    add(out, last);
  }

  if (stripped.includes(".") || stripped.includes("_") || stripped.includes("-")) {
    add(out, stripped.replace(/[._-]/g, ""));
    add(out, stripped.replace(/[._-]/g, "."));
    add(out, stripped.replace(/[._-]/g, "_"));
    add(out, stripped.replace(/[._-]/g, "-"));
  }

  return [...out];
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
