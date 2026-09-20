import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  clampWatchIntervalMs,
  createWatch,
  deleteWatch,
  diffFounds,
  foundSnapshot,
  listWatches,
  resetWatchesForTests,
} from "../server/watches.ts";
import { WATCH_DEFAULT_INTERVAL_MS, WATCH_MIN_INTERVAL_MS } from "../shared/scan-limits.ts";
import type { LedgerRow } from "../shared/types.ts";

const dir = mkdtempSync(join(tmpdir(), "umbra-watch-"));
const prevCases = process.env.UMBRA_CASES_DIR;
const prevMin = process.env.UMBRA_WATCH_MIN_MS;

afterEach(() => {
  resetWatchesForTests();
  if (prevCases === undefined) delete process.env.UMBRA_CASES_DIR;
  else process.env.UMBRA_CASES_DIR = prevCases;
  if (prevMin === undefined) delete process.env.UMBRA_WATCH_MIN_MS;
  else process.env.UMBRA_WATCH_MIN_MS = prevMin;
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function row(site: string): LedgerRow {
  return {
    id: site,
    scanId: "s",
    mode: "handle",
    target: "octocat",
    site,
    category: "social",
    status: "found",
    reason: "ok",
    url: `https://example.com/${site}`,
    method: "GET",
  };
}

describe("watch lists", () => {
  it("clamps interval to at least 1 hour by default", () => {
    delete process.env.UMBRA_WATCH_MIN_MS;
    expect(clampWatchIntervalMs(60_000)).toBe(WATCH_MIN_INTERVAL_MS);
    expect(clampWatchIntervalMs(undefined)).toBe(WATCH_DEFAULT_INTERVAL_MS);
    process.env.UMBRA_WATCH_MIN_MS = "100";
    expect(clampWatchIntervalMs(10)).toBe(100);
  });

  it("diffs new founds against the last snapshot", () => {
    const prev = foundSnapshot([row("GitHub"), row("GitLab")]);
    const next = foundSnapshot([row("GitHub"), row("Bitbucket")]);
    const diff = diffFounds(prev, next);
    expect(diff.newFounds.map((f) => f.site)).toEqual(["Bitbucket"]);
    expect(diff.goneFounds.map((f) => f.site)).toEqual(["GitLab"]);
  });

  it("persists watches next to the cases volume and rejects crawl seeds", () => {
    process.env.UMBRA_CASES_DIR = dir;
    process.env.UMBRA_WATCH_MIN_MS = "100";
    const rec = createWatch({ query: "octocat", mode: "handle", intervalMs: 100 });
    expect(rec.mode).toBe("handle");
    expect(listWatches().some((w) => w.id === rec.id)).toBe(true);
    expect(() => createWatch({ query: "https://example.com" })).toThrow(/crawl/i);
    expect(deleteWatch(rec.id)).toBe(true);
  });
});
