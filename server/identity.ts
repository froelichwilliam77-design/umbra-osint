import type { AvatarCluster, IdentityCluster, IdentityClusterMember, LedgerRow } from "../shared/types.ts";

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normHandle(s: string): string {
  return s.replace(/^@/, "").trim().toLowerCase();
}

function memberFromRow(row: LedgerRow): IdentityClusterMember {
  return {
    site: row.site,
    url: row.profileUrl || row.url,
    handle: row.variant || (row.mode === "handle" ? row.target : undefined),
    displayName: row.metadata?.displayName,
    avatarUrl: row.metadata?.avatarUrl,
    phash: row.phash || row.metadata?.phash,
  };
}

function mergeMembers(into: IdentityClusterMember[], add: IdentityClusterMember[]): IdentityClusterMember[] {
  const seen = new Set(into.map((m) => `${m.site}|${m.url}`));
  const out = [...into];
  for (const m of add) {
    const key = `${m.site}|${m.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function clusterId(kind: string, key: string): string {
  return `${kind}:${key.slice(0, 48)}`;
}

/** Group found profiles that look like the same person: avatars, names, handles, websites. */
export function clusterIdentities(input: {
  rows: LedgerRow[];
  avatarClusters?: AvatarCluster[];
  query?: string;
}): IdentityCluster[] {
  const found = input.rows.filter((r) => r.status === "found");
  const out: IdentityCluster[] = [];

  for (const av of input.avatarClusters ?? []) {
    const members: IdentityClusterMember[] = (av.members ?? av.sites.map((site, i) => ({
      site,
      url: "",
      avatarUrl: av.avatarUrls[i] ?? av.avatarUrls[0],
      phash: av.phash,
    }))).map((m) => ({
      site: m.site,
      url: m.url,
      avatarUrl: m.avatarUrl,
      phash: av.phash,
    }));
    if (members.length < 2) continue;
    const distScore = Math.max(0.55, 0.95 - av.distanceMax * 0.03);
    out.push({
      id: clusterId("avatar", av.phash),
      label: `Same avatar · ${members.map((m) => m.site).slice(0, 4).join(", ")}`,
      kind: "avatar",
      confidence: Number(distScore.toFixed(2)),
      reasons: [`pHash Hamming ≤ ${av.distanceMax} across ${members.length} sites`],
      members,
    });
  }

  const byName = new Map<string, LedgerRow[]>();
  const byHandle = new Map<string, LedgerRow[]>();
  const bySite = new Map<string, LedgerRow[]>();
  for (const row of found) {
    const name = row.metadata?.displayName ? normName(row.metadata.displayName) : "";
    if (name.length >= 3 && name.split(" ").length >= 2) {
      const list = byName.get(name) ?? [];
      list.push(row);
      byName.set(name, list);
    }
    const handle = normHandle(row.variant || (row.mode === "handle" ? row.target : "") || "");
    if (handle.length >= 3) {
      const list = byHandle.get(handle) ?? [];
      list.push(row);
      byHandle.set(handle, list);
    }
    const web = (row.metadata?.website || "").trim().toLowerCase().replace(/\/+$/, "");
    if (web.startsWith("http") && web.length > 12) {
      const list = bySite.get(web) ?? [];
      list.push(row);
      bySite.set(web, list);
    }
  }

  for (const [name, rows] of byName) {
    const sites = new Set(rows.map((r) => r.site));
    if (sites.size < 2) continue;
    out.push({
      id: clusterId("name", name),
      label: `Same name “${rows[0]?.metadata?.displayName ?? name}”`,
      kind: "name",
      confidence: Math.min(0.72, 0.48 + sites.size * 0.08),
      reasons: [`Display name on ${sites.size} sites`],
      members: rows.map(memberFromRow),
    });
  }

  const seed = input.query ? normHandle(input.query.split("@")[0] ?? input.query) : "";
  for (const [handle, rows] of byHandle) {
    const sites = new Set(rows.map((r) => r.site));
    if (sites.size < 2) continue;
    const sameAsSeed = seed && handle === seed;
    out.push({
      id: clusterId("handle", handle),
      label: `Same handle @${handle}`,
      kind: "handle",
      confidence: sameAsSeed ? 0.82 : 0.74,
      reasons: [
        `Username “${handle}” on ${sites.size} sites`,
        sameAsSeed ? "Matches the seed identifier" : "Cross-site handle reuse",
      ],
      members: rows.map(memberFromRow),
    });
  }

  for (const [web, rows] of bySite) {
    const sites = new Set(rows.map((r) => r.site));
    if (sites.size < 2) continue;
    out.push({
      id: clusterId("website", web),
      label: `Shared website ${web.replace(/^https?:\/\//, "").slice(0, 40)}`,
      kind: "website",
      confidence: 0.62,
      reasons: [`Same website on ${sites.size} profiles`],
      members: rows.map(memberFromRow),
    });
  }

  // Union overlapping clusters into mixed groups when they share ≥2 members.
  const mixed: IdentityCluster[] = [];
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (a.kind === b.kind) continue;
      const urlsA = new Set(a.members.map((m) => m.url));
      const shared = b.members.filter((m) => urlsA.has(m.url) || a.members.some((x) => x.site === m.site && x.displayName && x.displayName === m.displayName));
      if (shared.length < 2 && !(a.kind === "avatar" && b.kind === "handle")) continue;
      if (a.kind === "avatar" && b.kind === "handle" && shared.length === 0) {
        const sitesA = new Set(a.members.map((m) => m.site));
        const overlapSites = b.members.filter((m) => sitesA.has(m.site));
        if (overlapSites.length < 2) continue;
      }
      mixed.push({
        id: clusterId("mixed", `${a.id}+${b.id}`),
        label: `Likely same person · ${a.kind} + ${b.kind}`,
        kind: "mixed",
        confidence: Math.min(0.98, Number(((a.confidence + b.confidence) / 2 + 0.08).toFixed(2))),
        reasons: [...a.reasons, ...b.reasons],
        members: mergeMembers(a.members, b.members),
      });
    }
  }

  const ranked = [...out, ...mixed]
    .filter((c) => c.members.length >= 2)
    .sort((a, b) => b.confidence - a.confidence || b.members.length - a.members.length);

  const seen = new Set<string>();
  const unique: IdentityCluster[] = [];
  for (const c of ranked) {
    const key = `${c.kind}:${c.members
      .map((m) => m.site)
      .sort()
      .join(",")}`;
    if (seen.has(key) && c.kind !== "mixed") continue;
    seen.add(key);
    unique.push(c);
    if (unique.length >= 16) break;
  }
  return unique;
}

export function confidenceLabel(n: number): "high" | "medium" | "low" {
  if (n >= 0.8) return "high";
  if (n >= 0.6) return "medium";
  return "low";
}
