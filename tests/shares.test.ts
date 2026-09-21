import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { caseFromScan, persistCase, resetCasesForTests } from "../server/cases.ts";
import {
  createShare,
  publicShareView,
  resetSharesForTests,
  revokeShare,
  shareIsLive,
  sharePath,
} from "../server/shares.ts";
import type { LedgerRow, ScanSummary } from "../shared/types.ts";

const dir = mkdtempSync(join(tmpdir(), "umbra-share-"));
const prevCases = process.env.UMBRA_CASES_DIR;
const prevShares = process.env.UMBRA_SHARES_DIR;

afterEach(() => {
  resetCasesForTests();
  resetSharesForTests();
  process.env.UMBRA_CASES_DIR = dir;
  process.env.UMBRA_SHARES_DIR = join(dir, "shares");
});

afterAll(() => {
  if (prevCases === undefined) delete process.env.UMBRA_CASES_DIR;
  else process.env.UMBRA_CASES_DIR = prevCases;
  if (prevShares === undefined) delete process.env.UMBRA_SHARES_DIR;
  else process.env.UMBRA_SHARES_DIR = prevShares;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function summary(): ScanSummary {
  return {
    id: "case-1",
    query: "octocat",
    mode: "handle",
    requestedMode: "handle",
    createdAt: new Date().toISOString(),
    status: "done",
    preflight: { ok: true, kind: "handle", query: "octocat", normalized: "octocat", notes: [], warnings: [], errors: [] },
    progress: { done: 1, total: 1, found: 1, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 },
    includeNsfw: false,
    siteCount: 1,
    graph: { nodes: [{ id: "n", kind: "handle", label: "octocat" }], edges: [] },
  };
}

function row(): LedgerRow {
  return {
    id: "r1",
    scanId: "case-1",
    mode: "handle",
    target: "octocat",
    site: "GitHub",
    category: "social",
    status: "found",
    reason: "ok",
    url: "https://github.com/octocat",
    method: "GET",
    bodyExcerpt: "SECRET_SHOULD_NOT_LEAK",
  };
}

describe("read-only share links", () => {
  it("mints an opaque token URL and strips body excerpts", () => {
    process.env.UMBRA_CASES_DIR = dir;
    persistCase(caseFromScan(summary(), [row()]));
    const rec = createShare({ caseId: "case-1", expiresInHours: 24 });
    expect(rec.token.length).toBeGreaterThan(20);
    expect(sharePath(rec.token)).toBe(`/share/${rec.token}`);
    expect(shareIsLive(rec)).toBe(true);
    const view = publicShareView(rec.token);
    expect(view?.query).toBe("octocat");
    expect(view?.readOnly).toBe(true);
    expect(view?.foundRows[0]?.site).toBe("GitHub");
    expect(view?.foundRows[0]?.bodyExcerpt).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/SECRET_SHOULD_NOT_LEAK/);
    expect(JSON.stringify(view)).not.toMatch(/HIBP_API_KEY|SMTP_PASS|BOT_TOKEN/);
    expect(publicShareView(rec.token, "other")).toBeNull();
  });

  it("expires and revokes", () => {
    process.env.UMBRA_CASES_DIR = dir;
    persistCase(caseFromScan(summary(), [row()]));
    const rec = createShare({ caseId: "case-1", expiresInHours: 24 });
    rec.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(shareIsLive(rec)).toBe(false);
    const live = createShare({ caseId: "case-1" });
    expect(publicShareView(live.token)?.query).toBe("octocat");
    revokeShare(live.token);
    expect(publicShareView(live.token)).toBeNull();
  });
});
