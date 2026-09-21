import { describe, expect, it, afterEach } from "vitest";
import { HostPool } from "../server/concurrency.ts";
import { readLimitedBody, readLimitedBytes } from "../server/http.ts";
import {
  clampPerHost,
  clampWorkers,
  impersonateMax,
  playwrightConcurrent,
  playwrightRetryMax,
} from "../server/limits.ts";
import { setRssReaderForTests } from "../server/memory.ts";
import { playwrightEnabled, playwrightMax } from "../server/playwright-pool.ts";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
  setRssReaderForTests(null);
});

describe("Playwright default-off", () => {
  it("is disabled unless UMBRA_PLAYWRIGHT is 1/true/on", () => {
    delete process.env.UMBRA_PLAYWRIGHT;
    expect(playwrightEnabled()).toBe(false);
    for (const v of ["", "0", "false", "off", "no"]) {
      process.env.UMBRA_PLAYWRIGHT = v;
      expect(playwrightEnabled()).toBe(false);
    }
    process.env.UMBRA_PLAYWRIGHT = "1";
    expect(playwrightEnabled()).toBe(true);
    process.env.UMBRA_PLAYWRIGHT = "true";
    expect(playwrightEnabled()).toBe(true);
  });

  it("defaults to max 1 retry and 1 concurrent browser", () => {
    delete process.env.UMBRA_PLAYWRIGHT_MAX;
    expect(playwrightMax()).toBe(1);
    expect(playwrightRetryMax()).toBe(1);
    expect(playwrightConcurrent()).toBe(1);
    process.env.UMBRA_PLAYWRIGHT_MAX = "20";
    expect(playwrightMax()).toBeLessThanOrEqual(3);
  });
});

describe("concurrency caps", () => {
  it("clamps global workers and per-host for 1 GB boxes", () => {
    delete process.env.UMBRA_WORKERS;
    delete process.env.UMBRA_WORKERS_MAX;
    delete process.env.UMBRA_PER_HOST;
    expect(clampWorkers(undefined)).toBe(4);
    expect(clampWorkers(48)).toBe(8);
    expect(clampWorkers(1)).toBe(1);
    expect(clampPerHost(undefined)).toBe(1);
    expect(clampPerHost(8)).toBe(2);
  });

  it("caps concurrent curl-impersonate children", () => {
    delete process.env.UMBRA_CURL_MAX;
    expect(impersonateMax()).toBe(0);
    process.env.UMBRA_CURL_MAX = "99";
    expect(impersonateMax()).toBe(2);
  });

  it("HostPool respects global and per-host limits", async () => {
    const pool = new HostPool({ global: 2, perHost: 1 });
    let inflight = 0;
    let maxInflight = 0;
    const perHost = new Map<string, number>();
    let maxPerHost = 0;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => {
        const host = i % 2 === 0 ? "a.example" : "b.example";
        return pool.schedule(host, async () => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          perHost.set(host, (perHost.get(host) ?? 0) + 1);
          maxPerHost = Math.max(maxPerHost, perHost.get(host) ?? 0);
          await new Promise((r) => setTimeout(r, 25));
          perHost.set(host, (perHost.get(host) ?? 1) - 1);
          inflight -= 1;
        });
      }),
    );
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxPerHost).toBeLessThanOrEqual(1);
  });

  it("HostPool skips remaining work after abort", async () => {
    const pool = new HostPool({ global: 1, perHost: 1 });
    const ran: number[] = [];
    await Promise.all([
      pool.schedule("h", async () => {
        ran.push(1);
        pool.abort("test");
      }),
      pool.schedule("h", async () => {
        ran.push(2);
      }),
    ]);
    expect(ran).toEqual([1]);
    expect(pool.isAborted).toBe(true);
    expect(() => pool.throwIfAborted()).toThrow(/test/);
  });

  it("HostPool aborts under hard memory pressure", async () => {
    setRssReaderForTests(() => 900 * 1024 * 1024);
    const pool = new HostPool({ global: 2, perHost: 1 });
    const ran: string[] = [];
    await Promise.all([
      pool.schedule("h", async () => {
        ran.push("a");
      }),
      pool.schedule("h", async () => {
        ran.push("b");
      }),
    ]);
    expect(ran).toEqual([]);
    expect(pool.isAborted).toBe(true);
    expect(pool.abortedReason).toMatch(/1 GB memory limit|memory/i);
  });
});

describe("streamed body cap", () => {
  it("truncates a ReadableStream without buffering the tail", async () => {
    const { bodyLimit } = await import("../server/limits.ts");
    const limit = bodyLimit();
    const payload = "x".repeat(limit + 8_000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const text = await readLimitedBody({ body: stream });
    expect(text.length).toBe(limit);
    const bytes = await readLimitedBytes({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(limit + 4_000).fill(7));
          controller.close();
        },
      }),
    });
    expect(bytes.length).toBe(limit);
  });
});
