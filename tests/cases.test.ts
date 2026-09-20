import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  caseFromScan,
  compareCases,
  deleteCase,
  exportCase,
  getCase,
  listCases,
  persistCase,
  resetCasesForTests,
} from "../server/cases.ts";
import { compareScans } from "../shared/compare.ts";
import type { LedgerRow, ScanSummary } from "../shared/types.ts";

function summary(id: string, query: string, found: number): ScanSummary {
  return {
    id,
    query,
    mode: "mail",
    requestedMode: "mail",
    createdAt: new Date().toISOString(),
    status: "done",
    preflight: { ok: true, kind: "mail", query, normalized: query, notes: [], warnings: [], errors: [] },
    progress: { done: found, total: found, found, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 },
    includeNsfw: false,
    siteCount: found,
    dossier: {
      email: query,
      localPart: query.split("@")[0] ?? query,
      domain: query.split("@")[1] ?? "example.com",
      disposable: false,
      roleBased: false,
      plusAddress: false,
      mx: [],
      hasMx: true,
      domainSpf: [],
      domainDmarc: [],
      dkim: [],
      pivots: [query.split("@")[0] ?? query],
      localPartAnalysis: { localPart: query.split("@")[0] ?? query, base: query.split("@")[0] ?? query, patterns: [], possibleNames: [] },
      openLinks: [],
    },
  };
}

function row(site: string, status: LedgerRow["status"] = "found"): LedgerRow {
  return {
    id: site,
    scanId: "x",
    mode: "mail",
    target: "a@b.c",
    site,
    category: "oracle",
    status,
    reason: "ok",
    url: `https://example.com/${site}`,
    method: "GET",
  };
}

describe("saved cases", () => {
  const prev = process.env.UMBRA_CASES_DIR;
  const dir = mkdtempSync(join(tmpdir(), "umbra-cases-"));

  afterEach(() => {
    resetCasesForTests();
    if (prev === undefined) delete process.env.UMBRA_CASES_DIR;
    else process.env.UMBRA_CASES_DIR = prev;
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("persists dossier + found rows + graph on a volume path", () => {
    process.env.UMBRA_CASES_DIR = dir;
    const rec = persistCase(
      caseFromScan(summary("c1", "press@github.com", 2), [row("GitHub"), row("Nope", "miss")], {
        nodes: [{ id: "n1", kind: "mail", label: "press@github.com" }],
        edges: [],
      }),
    );
    expect(rec.foundRows.map((r) => r.site)).toEqual(["GitHub"]);
    expect(getCase("c1")?.query).toBe("press@github.com");
    expect(listCases().some((c) => c.id === "c1")).toBe(true);
    const file = exportCase("c1", "md");
    expect(file?.body).toMatch(/press@github.com/);
    expect(file?.body).toMatch(/GitHub/);
    const html = exportCase("c1", "html");
    expect(html?.body).toMatch(/executive report/);
    expect(html?.body).toMatch(/press@github.com/);
    expect(html?.body).toMatch(/Print \/ Save as PDF/);
    expect(deleteCase("c1")).toBe(true);
    expect(getCase("c1")).toBeNull();
  });

  it("compares two saved cases side by side", () => {
    process.env.UMBRA_CASES_DIR = dir;
    persistCase(caseFromScan(summary("a", "ada@example.com", 2), [row("GitHub"), row("GitLab")]));
    persistCase(caseFromScan(summary("b", "ada@example.com", 2), [row("GitHub"), row("Bitbucket")]));
    const diff = compareCases("a", "b");
    expect(diff?.both.map((x) => x.site)).toContain("GitHub");
    expect(diff?.onlyA.map((x) => x.site)).toContain("GitLab");
    expect(diff?.onlyB.map((x) => x.site)).toContain("Bitbucket");
    const same = compareScans(
      { summary: summary("a", "x", 1), rows: [row("GitHub")] },
      { summary: summary("b", "x", 1), rows: [row("GitHub")] },
    );
    expect(same.both).toHaveLength(1);
    expect(same.onlyA).toHaveLength(0);
  });
});
