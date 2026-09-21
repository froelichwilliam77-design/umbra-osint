import { describe, expect, it } from "vitest";
import { likelyEmailsFromHandle, planAutoPivots, relatedHandlesFromRows } from "../server/auto-pivots.ts";
import type { LedgerRow, ScanSummary } from "../shared/types.ts";

function summary(partial: Partial<ScanSummary>): ScanSummary {
  return {
    id: "s1",
    query: "octocat",
    mode: "handle",
    requestedMode: "handle",
    createdAt: new Date().toISOString(),
    status: "done",
    preflight: { ok: true, kind: "handle", query: "octocat", normalized: "octocat", notes: [], warnings: [], errors: [] },
    progress: { done: 1, total: 1, found: 1, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 },
    includeNsfw: false,
    siteCount: 1,
    profile: "full",
    pivotDepth: 0,
    ...partial,
  };
}

describe("auto-pivots", () => {
  it("queues likely gmail from a handle seed", () => {
    expect(likelyEmailsFromHandle("octocat", 2)[0]).toBe("octocat@gmail.com");
    const jobs = planAutoPivots({ summary: summary({ mode: "handle", query: "octocat" }), rows: [] });
    expect(jobs.some((j) => j.mode === "mail" && j.query.endsWith("@gmail.com"))).toBe(true);
  });

  it("queues local-part handle after mail and does not recurse past depth", () => {
    const mail = summary({
      mode: "mail",
      query: "ada.lovelace@example.com",
      dossier: {
        email: "ada.lovelace@example.com",
        localPart: "ada.lovelace",
        domain: "example.com",
        disposable: false,
        roleBased: false,
        plusAddress: false,
        mx: [],
        hasMx: true,
        domainSpf: [],
        domainDmarc: [],
        dkim: [],
        pivots: ["ada.lovelace", "adalovelace"],
        localPartAnalysis: { localPart: "ada.lovelace", base: "ada.lovelace", patterns: [], possibleNames: [] },
        openLinks: [],
      },
    });
    const jobs = planAutoPivots({ summary: mail, rows: [] });
    expect(jobs.some((j) => j.mode === "handle" && j.query.includes("ada"))).toBe(true);

    const deep = planAutoPivots({ summary: summary({ pivotDepth: 1, mode: "handle", query: "octocat" }), rows: [] });
    expect(deep).toEqual([]);
  });

  it("extracts related handles from found metadata without looping the seed", () => {
    const rows: LedgerRow[] = [
      {
        id: "1",
        scanId: "s",
        mode: "handle",
        target: "octocat",
        site: "GitHub",
        category: "coding",
        status: "found",
        reason: "ok",
        url: "https://api.github.com/users/octocat",
        method: "GET",
        metadata: { extra: { twitter_username: "monalisa", login: "octocat" } },
      },
    ];
    expect(relatedHandlesFromRows(rows, "octocat", 2)).toContain("monalisa");
    expect(relatedHandlesFromRows(rows, "octocat", 2)).not.toContain("octocat");
  });

  it("can be disabled", () => {
    const jobs = planAutoPivots({
      summary: summary({ mode: "handle", query: "octocat" }),
      rows: [],
      autoPivots: false,
    });
    expect(jobs).toEqual([]);
  });
});
