import { describe, expect, it } from "vitest";
import { impersonateAvailable, impersonateHealth, isWafHeavy, shouldImpersonate, tlsMode } from "../server/curl-impersonate.ts";
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

  it("keeps Playwright off by default and only escalates GET challenge rows", () => {
    const prev = process.env.UMBRA_PLAYWRIGHT;
    delete process.env.UMBRA_PLAYWRIGHT;
    try {
      expect(playwrightEnabled()).toBe(false);
      expect(shouldEscalateBrowser("blocked", "Cloudflare challenge body", "GET")).toBe(true);
      expect(shouldEscalateBrowser("blocked", "Cloudflare challenge body", "POST")).toBe(false);
      expect(shouldEscalateBrowser("miss", "Missing match", "GET")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.UMBRA_PLAYWRIGHT;
      else process.env.UMBRA_PLAYWRIGHT = prev;
    }
  });

  it("does not auto-impersonate mail oracles unless the host is WAF-heavy", () => {
    const want = shouldImpersonate({ oracle: true, url: "https://github.com/signup_check/email" });
    expect(want).toBe(false);
    expect(isWafHeavy({ url: "https://www.reddit.com/api/check_email.json" })).toBe(true);
  });

  it("impersonates Cloudflare-protected hosts when a binary exists", () => {
    const want = shouldImpersonate({
      protection: ["cloudflare"],
      url: "https://discord.com/api/v9/unique-username/username-attempt-unauthed",
    });
    if (impersonateAvailable()) expect(want).toBe(true);
    else expect(want).toBe(false);
  });
});
