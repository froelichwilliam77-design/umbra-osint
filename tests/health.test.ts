import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { healthPayload } from "../server/health.ts";
import { playwrightEnabled } from "../server/playwright-pool.ts";

describe("health + service worker", () => {
  it("reports playwright enabled:false with memory-safe limits after defaults", async () => {
    const prev = process.env.UMBRA_PLAYWRIGHT;
    delete process.env.UMBRA_PLAYWRIGHT;
    try {
      expect(playwrightEnabled()).toBe(false);
      const h = await healthPayload();
      expect(h.ok).toBe(true);
      expect(h.playwright.enabled).toBe(false);
      expect(h.playwright.max).toBe(1);
      expect(h.playwright.concurrent).toBe(1);
      expect(h.limits.workers).toBe(8);
      expect(h.limits.perHost).toBe(1);
      expect(h.limits.curlMax).toBe(3);
      expect(h.memory.pressure).toMatch(/ok|soft|hard/);
    } finally {
      if (prev === undefined) delete process.env.UMBRA_PLAYWRIGHT;
      else process.env.UMBRA_PLAYWRIGHT = prev;
    }
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
});
