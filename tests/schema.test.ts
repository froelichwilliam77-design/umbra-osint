import { describe, expect, it } from "vitest";
import { handlers } from "../server/mail-oracles.ts";
import { loadSchema, schemaStats, sitesForScan } from "../server/schema.ts";

describe("schema integrity", () => {
  it("loads WMN + curated overlay", () => {
    const stats = schemaStats();
    expect(stats.handleSites).toBeGreaterThan(700);
    expect(stats.oracles).toBeGreaterThan(45);
    expect(stats.disposableDomains).toBeGreaterThan(250);
  });

  it("has a handler for every oracle", () => {
    const missing = loadSchema().oracles.filter((o) => !handlers[o.handler]);
    expect(missing).toEqual([]);
  });

  it("excludes NSFW by default", () => {
    const all = sitesForScan(true);
    const clean = sitesForScan(false);
    expect(all.length).toBeGreaterThanOrEqual(clean.length);
    expect(clean.every((s) => (s.cat || "").toLowerCase() !== "xx nsfw xx")).toBe(true);
  });
});
