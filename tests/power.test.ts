import { afterEach, describe, expect, it } from "vitest";
import { crawlPageCap, defaultWorkers, impersonateMax } from "../server/limits.ts";
import { powerActive, powerEnvEnabled } from "../server/power.ts";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

describe("power profile", () => {
  it("stays off on lean 1 GB defaults", () => {
    delete process.env.UMBRA_POWER;
    delete process.env.UMBRA_PROFILE;
    delete process.env.UMBRA_CURL_MAX;
    delete process.env.UMBRA_WORKERS;
    expect(powerEnvEnabled()).toBe(false);
    expect(powerActive()).toBe(false);
    expect(impersonateMax()).toBe(0);
    expect(defaultWorkers()).toBe(4);
    expect(crawlPageCap("lean")).toBe(25);
  });

  it("UMBRA_POWER=1 raises workers and allows TLS children even if CURL_MAX was 0", () => {
    process.env.UMBRA_POWER = "1";
    process.env.UMBRA_CURL_MAX = "0";
    process.env.UMBRA_WORKERS = "4";
    expect(powerEnvEnabled()).toBe(true);
    expect(powerActive()).toBe(true);
    expect(impersonateMax()).toBe(1);
    expect(defaultWorkers()).toBe(8);
    expect(crawlPageCap()).toBe(100);
  });

  it("does not enable Playwright", async () => {
    process.env.UMBRA_POWER = "1";
    delete process.env.UMBRA_PLAYWRIGHT;
    const { playwrightEnabled } = await import("../server/playwright-pool.ts");
    expect(playwrightEnabled()).toBe(false);
  });
});
