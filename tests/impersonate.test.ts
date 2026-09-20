import { describe, expect, it } from "vitest";
import { impersonateAvailable, impersonateHealth, shouldImpersonate, tlsMode } from "../server/curl-impersonate.ts";
import { playwrightEnabled, shouldEscalateBrowser } from "../server/playwright-pool.ts";

describe("TLS impersonation + Playwright flags", () => {
  it("reports health without throwing when curl-impersonate is absent", () => {
    const h = impersonateHealth();
    expect(h.tlsMode).toBe(tlsMode());
    expect(typeof h.tlsImpersonation).toBe("boolean");
    expect(h.tlsNote.length).toBeGreaterThan(20);
    expect(impersonateAvailable()).toBe(h.tlsImpersonation);
  });

  it("auto-impersonates protected hosts only when a binary exists", () => {
    const want = shouldImpersonate({ protection: ["cloudflare"], url: "https://x.com/octocat" });
    if (impersonateAvailable()) expect(want).toBe(true);
    else expect(want).toBe(false);
  });

  it("keeps Playwright off outside production and only escalates GET challenge rows", () => {
    expect(playwrightEnabled()).toBe(false);
    expect(shouldEscalateBrowser("blocked", "Cloudflare challenge body", "GET")).toBe(true);
    expect(shouldEscalateBrowser("blocked", "Cloudflare challenge body", "POST")).toBe(false);
    expect(shouldEscalateBrowser("miss", "Missing match", "GET")).toBe(false);
  });

  it("auto-impersonates mail oracles when a binary exists", () => {
    const want = shouldImpersonate({ oracle: true, url: "https://github.com/signup_check/email" });
    if (impersonateAvailable()) expect(want).toBe(true);
    else expect(want).toBe(false);
  });
});
