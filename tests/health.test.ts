import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { healthPayload } from "../server/health.ts";
import { playwrightEnabled } from "../server/playwright-pool.ts";
import { setDetectedRamMbForTests } from "../server/power.ts";

afterEach(() => {
  setDetectedRamMbForTests(1024);
});

describe("health + service worker", () => {
  it("reports playwright enabled:false with memory-safe limits after defaults", async () => {
    const prev = process.env.UMBRA_PLAYWRIGHT;
    delete process.env.UMBRA_PLAYWRIGHT;
    delete process.env.UMBRA_WORKERS;
    delete process.env.UMBRA_WORKERS_MAX;
    delete process.env.UMBRA_CURL_MAX;
    delete process.env.UMBRA_BODY_LIMIT;
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    setDetectedRamMbForTests(1024);
    try {
      expect(playwrightEnabled()).toBe(false);
      const h = await healthPayload();
      expect(h.ok).toBe(true);
      expect(h.playwright.enabled).toBe(false);
      expect(h.playwright.max).toBe(1);
      expect(h.playwright.concurrent).toBe(1);
      expect(h.limits.workers).toBe(4);
      expect(h.limits.perHost).toBe(1);
      expect(h.limits.curlMax).toBe(0);
      expect(h.limits.memSoftMb).toBe(450);
      expect(h.limits.memHardMb).toBe(600);
      expect(h.limits.bodyLimit).toBe(48000);
      expect(["lean", "full"]).toContain(h.limits.profile);
      expect(h.memory.pressure).toMatch(/ok|soft|hard/);
    } finally {
      if (prev === undefined) delete process.env.UMBRA_PLAYWRIGHT;
      else process.env.UMBRA_PLAYWRIGHT = prev;
    }
  });

  it("reports scaled mem watermarks on an 8 GB host", async () => {
    delete process.env.UMBRA_MEM_SOFT_MB;
    delete process.env.UMBRA_MEM_HARD_MB;
    delete process.env.UMBRA_RSS_SOFT_MB;
    delete process.env.UMBRA_RSS_HARD_MB;
    setDetectedRamMbForTests(7629);
    const h = await healthPayload();
    expect(h.limits.memSoftMb).toBe(Math.round(7629 * 0.7));
    expect(h.limits.memHardMb).toBe(Math.round(7629 * 0.85));
    expect(h.limits.memSoftMb).toBeGreaterThan(450);
    expect(h.memory.softMb).toBe(h.limits.memSoftMb);
    expect(h.memory.hardMb).toBe(h.limits.memHardMb);
    expect(h.power.ramMb).toBe(7629);
    expect(h.power.ramAllowsPower).toBe(true);
  });

  it("bumps the PWA cache and never falls back to stale index HTML for assets", () => {
    const src = readFileSync(new URL("../client/public/sw.js", import.meta.url), "utf8");
    expect(src).toMatch(/umbra-shell-v4/);
    expect(src).not.toMatch(/umbra-shell-v1/);
    expect(src).not.toMatch(/umbra-shell-v2/);
    expect(src).toMatch(/cache:\s*"no-store"/);
    expect(src).not.toMatch(/cache\.addAll\(\["\/"/);
    expect(src).not.toMatch(/caches\.match\("\/"\)/);
    expect(src).toMatch(/skipWaiting/);
    expect(src).toMatch(/clients\.claim/);
    // Network-only HTML / navigations — never serve stale shell HTML as a script.
    expect(src).toMatch(/isNavigate/);
    expect(src).toMatch(/pathname\.startsWith\("\/assets\/"\)/);
  });

  it("does not declare a Docker VOLUME (Railway Metal rejects it)", () => {
    const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(docker).not.toMatch(/^\s*VOLUME\b/m);
    expect(docker).toMatch(/Do NOT add a Dockerfile VOLUME/);
  });

  it("does not pin 1 GB RSS watermarks in the image (so ≥2 GB hosts can auto-scale)", () => {
    const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(docker).not.toMatch(/^\s*ENV UMBRA_MEM_SOFT_MB=/m);
    expect(docker).not.toMatch(/^\s*ENV UMBRA_MEM_HARD_MB=/m);
    expect(docker).not.toMatch(/^\s*ENV UMBRA_RSS_SOFT_MB=/m);
    expect(docker).not.toMatch(/^\s*ENV UMBRA_RSS_HARD_MB=/m);
  });
});
