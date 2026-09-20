import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAST_TIER_SIZE,
  LEAN_SITE_CAP,
  SSE_FLUSH_MS,
  createBatcher,
  inferDefaultProfile,
  ledgerWindow,
  parseScanProfile,
  rssPressureOf,
} from "../shared/scan-limits.ts";
import { splitFastTier, type WmnSite } from "../server/schema.ts";
import { bodyLimit, memoryHardMb, memorySoftMb } from "../server/limits.ts";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
  vi.useRealTimers();
});

describe("scan profile + SSE batching", () => {
  it("parses lean/full aliases", () => {
    expect(parseScanProfile("lean")).toBe("lean");
    expect(parseScanProfile("FAST")).toBe("lean");
    expect(parseScanProfile("full")).toBe("full");
    expect(parseScanProfile("nope", "lean")).toBe("lean");
  });

  it("defaults Railway to lean and local to full", () => {
    expect(inferDefaultProfile({ UMBRA_PROFILE: "full" })).toBe("full");
    expect(inferDefaultProfile({ UMBRA_PROFILE: "lean" })).toBe("lean");
    expect(inferDefaultProfile({ RAILWAY_ENVIRONMENT: "production" })).toBe("lean");
    expect(inferDefaultProfile({ RAILWAY_PROJECT_ID: "abc" })).toBe("lean");
    expect(inferDefaultProfile({})).toBe("full");
  });

  it("exposes process vs cgroup RSS in the health snapshot", async () => {
    const { memorySnapshot, setRssReaderForTests } = await import("../server/memory.ts");
    setRssReaderForTests(() => 200 * 1024 * 1024);
    const snap = memorySnapshot();
    expect(snap.rssMb).toBe(200);
    expect(snap.processRssMb).toBeGreaterThan(0);
    expect(snap.softMb).toBe(450);
    expect(snap.hardMb).toBe(600);
    setRssReaderForTests(null);
  });

  it("uses 450/600 RSS watermarks and 48 KB bodies", () => {
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    delete process.env.UMBRA_BODY_LIMIT;
    expect(memorySoftMb()).toBe(450);
    expect(memoryHardMb()).toBe(600);
    expect(bodyLimit()).toBe(48_000);
    expect(rssPressureOf(449, 450, 600)).toBe("ok");
    expect(rssPressureOf(450, 450, 600)).toBe("soft");
    expect(rssPressureOf(600, 450, 600)).toBe("hard");
  });

  it("virtualizes the ledger to ~40 rendered rows", () => {
    const win = ledgerWindow({
      scrollTop: 0,
      viewportHeight: 420,
      rowHeight: 64,
      count: 1000,
      overscan: 16,
    });
    expect(win.rendered).toBeLessThanOrEqual(50);
    expect(win.rendered).toBeGreaterThan(20);
    expect(win.totalHeight).toBe(64_000);
    const mid = ledgerWindow({
      scrollTop: 3200,
      viewportHeight: 420,
      rowHeight: 64,
      count: 1000,
    });
    expect(mid.start).toBeGreaterThan(0);
    expect(mid.end).toBeLessThan(1000);
    expect(mid.rendered).toBeLessThanOrEqual(50);
  });

  it("coalesces SSE row flushes on a timer", () => {
    vi.useFakeTimers();
    const batches: number[][] = [];
    const batcher = createBatcher<number>((items) => batches.push(items), SSE_FLUSH_MS);
    batcher.push(1);
    batcher.push(2);
    batcher.pushMany([3, 4]);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(SSE_FLUSH_MS);
    expect(batches).toEqual([[1, 2, 3, 4]]);
    batcher.push(5);
    batcher.flush();
    expect(batches).toEqual([[1, 2, 3, 4], [5]]);
  });

  it("splits a fast tier then the rest", () => {
    const sites = Array.from({ length: 400 }, (_, i) => ({
      name: `s${i}`,
      uri_check: `https://example.com/${i}/{account}`,
      e_code: 200,
      e_string: "ok",
      m_code: 404,
      m_string: "no",
      cat: "social",
    })) as WmnSite[];
    const { fast, rest } = splitFastTier(sites, FAST_TIER_SIZE);
    expect(fast.length).toBe(FAST_TIER_SIZE);
    expect(rest.length).toBe(400 - FAST_TIER_SIZE);
    expect(LEAN_SITE_CAP).toBe(200);
  });
});
