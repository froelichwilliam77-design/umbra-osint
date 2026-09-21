import { afterEach, describe, expect, it } from "vitest";
import { crawlPageCap, defaultWorkers, impersonateMax } from "../server/limits.ts";
import {
  beginScanPower,
  endScanPower,
  powerActive,
  powerEnvEnabled,
  ramAllowsPower,
  resetScanPowerForTests,
  setDetectedRamMbForTests,
} from "../server/power.ts";
import { POWER_RAM_MB } from "../shared/scan-limits.ts";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
  resetScanPowerForTests();
  setDetectedRamMbForTests(1024);
});

describe("power profile", () => {
  it("stays off on lean 1 GB defaults", () => {
    delete process.env.UMBRA_POWER;
    delete process.env.UMBRA_PROFILE;
    delete process.env.UMBRA_CURL_MAX;
    delete process.env.UMBRA_WORKERS;
    expect(POWER_RAM_MB).toBe(1800);
    expect(powerEnvEnabled()).toBe(false);
    expect(powerActive()).toBe(false);
    expect(impersonateMax()).toBe(0);
    expect(defaultWorkers()).toBe(4);
    expect(crawlPageCap("lean")).toBe(25);
  });

  it("UMBRA_PROFILE=full alone does not enable TLS on 1 GB", () => {
    process.env.UMBRA_PROFILE = "full";
    delete process.env.UMBRA_POWER;
    delete process.env.UMBRA_CURL_MAX;
    expect(powerEnvEnabled()).toBe(false);
    expect(powerActive("full")).toBe(false);
    expect(impersonateMax()).toBe(0);
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

  it("cgroup RAM ≥ ~1800 MB is Power (TLS + 8 workers)", () => {
    delete process.env.UMBRA_POWER;
    delete process.env.UMBRA_CURL_MAX;
    setDetectedRamMbForTests(1800);
    expect(ramAllowsPower()).toBe(true);
    expect(powerActive()).toBe(true);
    expect(impersonateMax()).toBe(1);
    expect(defaultWorkers()).toBe(8);
  });

  it("UI Power session enables TLS on a 1 GB box without flipping Playwright", async () => {
    delete process.env.UMBRA_POWER;
    process.env.UMBRA_CURL_MAX = "0";
    setDetectedRamMbForTests(1024);
    expect(impersonateMax()).toBe(0);
    beginScanPower();
    expect(powerActive()).toBe(true);
    expect(impersonateMax()).toBe(1);
    endScanPower();
    expect(impersonateMax()).toBe(0);
    delete process.env.UMBRA_PLAYWRIGHT;
    const { playwrightEnabled } = await import("../server/playwright-pool.ts");
    expect(playwrightEnabled()).toBe(false);
  });

  it("does not enable Playwright", async () => {
    process.env.UMBRA_POWER = "1";
    delete process.env.UMBRA_PLAYWRIGHT;
    const { playwrightEnabled } = await import("../server/playwright-pool.ts");
    expect(playwrightEnabled()).toBe(false);
  });
});
