import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAST_TIER_SIZE,
  LEAN_SITE_CAP,
  POWER_RAM_MB,
  SSE_FLUSH_MS,
  createBatcher,
  inferDefaultProfile,
  ledgerWindow,
  parseScanProfile,
  progressPercent,
  rssPressureOf,
} from "../shared/scan-limits.ts";
import { splitFastTier, type WmnSite } from "../server/schema.ts";
import {
  autoMemoryHardMb,
  autoMemorySoftMb,
  bodyLimit,
  MEM_HARD_CAP_MB,
  MEM_SOFT_CAP_MB,
  memoryHardMb,
  memorySoftMb,
} from "../server/limits.ts";
import { setDetectedRamMbForTests } from "../server/power.ts";
import { memoryPressure, setRssReaderForTests } from "../server/memory.ts";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
  setDetectedRamMbForTests(1024);
  setRssReaderForTests(null);
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
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    setDetectedRamMbForTests(1024);
    const { memorySnapshot, setRssReaderForTests } = await import("../server/memory.ts");
    setRssReaderForTests(() => 200 * 1024 * 1024);
    const snap = memorySnapshot();
    expect(snap.rssMb).toBe(200);
    expect(snap.processRssMb).toBeGreaterThan(0);
    expect(snap.softMb).toBe(450);
    expect(snap.hardMb).toBe(600);
    setRssReaderForTests(null);
  });

  it("uses 450/600 RSS watermarks and 48 KB bodies on 1 GB", () => {
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    delete process.env.UMBRA_BODY_LIMIT;
    setDetectedRamMbForTests(1024);
    expect(memorySoftMb()).toBe(450);
    expect(memoryHardMb()).toBe(600);
    expect(bodyLimit()).toBe(48_000);
    expect(rssPressureOf(449, 450, 600)).toBe("ok");
    expect(rssPressureOf(450, 450, 600)).toBe("soft");
    expect(rssPressureOf(600, 450, 600)).toBe("hard");
  });

  it("keeps lean 450/600 below the Power RAM threshold", () => {
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    setDetectedRamMbForTests(POWER_RAM_MB - 1);
    expect(memorySoftMb()).toBe(450);
    expect(memoryHardMb()).toBe(600);
    expect(autoMemorySoftMb(1024)).toBe(450);
    expect(autoMemoryHardMb(1799)).toBe(600);
  });

  it("scales soft/hard with detected RAM on ≥2 GB hosts", () => {
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    setDetectedRamMbForTests(7629);
    expect(memorySoftMb()).toBe(Math.round(7629 * 0.7));
    expect(memoryHardMb()).toBe(Math.round(7629 * 0.85));
    expect(memorySoftMb()).toBeGreaterThan(5000);
    expect(memoryHardMb()).toBeGreaterThan(memorySoftMb());
    expect(memorySoftMb()).toBeLessThanOrEqual(MEM_SOFT_CAP_MB);
    expect(memoryHardMb()).toBeLessThanOrEqual(MEM_HARD_CAP_MB);
    setRssReaderForTests(() => 100 * 1024 * 1024);
    expect(memoryPressure()).toBe("ok");
  });

  it("caps scaled watermarks and honors env overrides", () => {
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    expect(autoMemorySoftMb(20_000)).toBe(MEM_SOFT_CAP_MB);
    expect(autoMemoryHardMb(20_000)).toBe(MEM_HARD_CAP_MB);
    setDetectedRamMbForTests(7629);
    process.env.UMBRA_MEM_SOFT_MB = "900";
    process.env.UMBRA_MEM_HARD_MB = "1400";
    expect(memorySoftMb()).toBe(900);
    expect(memoryHardMb()).toBe(1400);
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    process.env.UMBRA_RSS_SOFT_MB = "800";
    process.env.UMBRA_RSS_HARD_MB = "1200";
    expect(memorySoftMb()).toBe(800);
    expect(memoryHardMb()).toBe(1200);
  });

  it("reports a clear progress percent", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(3, 9)).toBe(33);
    expect(progressPercent(9, 9)).toBe(100);
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
    expect(LEAN_SITE_CAP).toBe(250);
  });
});
