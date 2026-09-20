import { describe, expect, it } from "vitest";
import { buildIdentityGraph, compareScans } from "../server/graph.ts";
import type { LedgerRow, ScanSummary } from "../shared/types.ts";

function summary(partial: Partial<ScanSummary>): ScanSummary {
  return {
    id: partial.id ?? "a",
    query: partial.query ?? "octocat",
    mode: partial.mode ?? "handle",
    requestedMode: "auto",
    createdAt: new Date().toISOString(),
    status: "done",
    preflight: { ok: true, kind: partial.mode ?? "handle", query: "x", normalized: "x", notes: [], warnings: [], errors: [] },
    progress: { done: 1, total: 1, found: 1, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 },
    includeNsfw: false,
    siteCount: 1,
    dossier: partial.dossier,
    ...partial,
  };
}

function row(site: string, status: LedgerRow["status"] = "found"): LedgerRow {
  return {
    id: site,
    scanId: "a",
    mode: "handle",
    target: "octocat",
    site,
    category: "coding",
    status,
    reason: "ok",
    url: `https://example.com/${site}`,
    method: "GET",
  };
}

describe("identity graph + compare", () => {
  it("pivots mail → local-part handle and domain host", () => {
    const graph = buildIdentityGraph({
      summary: summary({
        query: "press@github.com",
        mode: "mail",
        dossier: {
          email: "press@github.com",
          localPart: "press",
          domain: "github.com",
          disposable: false,
          roleBased: true,
          plusAddress: false,
          mx: [],
          hasMx: true,
          domainSpf: [],
          domainDmarc: [],
          dkim: [],
          pivots: ["press"],
          localPartAnalysis: { localPart: "press", base: "press", patterns: ["role"], possibleNames: [] },
          openLinks: [],
          hibp: { enabled: true, breachCount: 1, breaches: [{ name: "Adobe", title: "Adobe" }] },
        },
      }),
      rows: [row("GitHub")],
    });
    expect(graph.nodes.some((n) => n.kind === "handle" && n.label === "press" && n.pivot?.mode === "handle")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "host" && n.label === "github.com" && n.pivot?.mode === "host")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "oracle" && /HIBP/.test(n.label))).toBe(true);
  });

  it("compares found-only site sets", () => {
    const a = { summary: summary({ id: "1", query: "octocat" }), rows: [row("GitHub"), row("GitLab", "miss")] };
    const b = { summary: summary({ id: "2", query: "octocat" }), rows: [row("GitHub"), row("Bitbucket")] };
    const c = compareScans(a, b);
    expect(c.both.map((x) => x.site)).toContain("GitHub");
    expect(c.onlyB.map((x) => x.site)).toContain("Bitbucket");
    expect(c.onlyA).toEqual([]);
  });
});
