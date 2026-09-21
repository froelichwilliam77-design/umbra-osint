import { describe, expect, it } from "vitest";
import { clusterIdentities, confidenceLabel } from "../server/identity.ts";
import { buildIdentityGraph } from "../server/graph.ts";
import type { LedgerRow, ScanSummary } from "../shared/types.ts";

function row(site: string, extra: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: site,
    scanId: "s",
    mode: "handle",
    target: "octocat",
    site,
    category: "coding",
    status: "found",
    reason: "ok",
    url: `https://example.com/${site}`,
    profileUrl: `https://example.com/${site}/octocat`,
    method: "GET",
    ...extra,
  };
}

describe("identity clustering", () => {
  it("groups the same display name and handle across sites with a confidence score", () => {
    const clusters = clusterIdentities({
      query: "octocat",
      rows: [
        row("GitHub", { metadata: { displayName: "The Octocat", website: "https://github.blog" } }),
        row("GitLab", { metadata: { displayName: "The Octocat", website: "https://github.blog" } }),
        row("Bitbucket", { metadata: { displayName: "Unrelated Person" } }),
      ],
      avatarClusters: [
        {
          phash: "101010",
          sites: ["GitHub", "GitLab"],
          avatarUrls: ["https://x/a.png", "https://x/b.png"],
          distanceMax: 2,
          members: [
            { site: "GitHub", url: "https://example.com/GitHub/octocat", avatarUrl: "https://x/a.png" },
            { site: "GitLab", url: "https://example.com/GitLab/octocat", avatarUrl: "https://x/b.png" },
          ],
        },
      ],
    });
    expect(clusters.some((c) => c.kind === "name" && c.members.length >= 2)).toBe(true);
    expect(clusters.some((c) => c.kind === "handle")).toBe(true);
    expect(clusters.some((c) => c.kind === "avatar" && c.confidence >= 0.8)).toBe(true);
    expect(clusters.some((c) => c.kind === "website")).toBe(true);
    expect(confidenceLabel(0.9)).toBe("high");
  });

  it("adds cluster nodes to the identity graph", () => {
    const summary = {
      id: "s",
      query: "octocat",
      mode: "handle",
      requestedMode: "handle",
      createdAt: new Date().toISOString(),
      status: "done",
      preflight: { ok: true, kind: "handle", query: "octocat", normalized: "octocat", notes: [], warnings: [], errors: [] },
      progress: { done: 2, total: 2, found: 2, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 },
      includeNsfw: false,
      siteCount: 2,
    } as ScanSummary;
    const graph = buildIdentityGraph({
      summary,
      rows: [row("GitHub"), row("GitLab")],
      identityClusters: [
        {
          id: "handle:octocat",
          label: "Same handle @octocat",
          kind: "handle",
          confidence: 0.82,
          reasons: ["Username on 2 sites"],
          members: [
            { site: "GitHub", url: "https://example.com/GitHub/octocat" },
            { site: "GitLab", url: "https://example.com/GitLab/octocat" },
          ],
        },
      ],
    });
    expect(graph.nodes.some((n) => n.kind === "cluster" && /82%/.test(n.label))).toBe(true);
  });
});
