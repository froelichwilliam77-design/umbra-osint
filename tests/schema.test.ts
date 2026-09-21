import { describe, expect, it } from "vitest";
import { handlers } from "../server/mail-oracles.ts";
import { loadSchema, rankSites, isChronicBlockedHandle, schemaStats, sitesForScan } from "../server/schema.ts";

describe("schema integrity", () => {
  it("loads WMN + curated overlay", () => {
    const stats = schemaStats();
    expect(stats.handleSites).toBeGreaterThan(900);
    expect(stats.sherlockSites ?? 0).toBeGreaterThan(200);
    expect(stats.oracles).toBeGreaterThan(140);
    expect(stats.disposableDomains).toBeGreaterThan(400);
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

  it("lean profile caps to curated + high-signal subset", () => {
    const full = sitesForScan(false, { profile: "full" });
    const lean = sitesForScan(false, { profile: "lean" });
    expect(lean.length).toBeLessThanOrEqual(300);
    expect(lean.length).toBeGreaterThanOrEqual(50);
    expect(full.length).toBeGreaterThan(lean.length);
    expect(schemaStats().leanSites).toBe(lean.length);
    expect(schemaStats().oraclesLean ?? 0).toBeGreaterThan(40);
    expect(schemaStats().oraclesLean ?? 0).toBeLessThan(schemaStats().oracles);
    const names = lean.map((s) => s.name.toLowerCase());
    expect(names.some((n) => n.includes("github"))).toBe(true);
    expect(names.some((n) => n === "instagram")).toBe(false);
    expect(names.some((n) => n === "tiktok")).toBe(false);
  });

  it("ranks API high-signal sites above chronically blocked social", () => {
    const ranked = rankSites(loadSchema().sites.filter((s) => (s.cat || "").toLowerCase() !== "xx nsfw xx"));
    const github = ranked.findIndex((s) => /github/i.test(s.name));
    const insta = ranked.findIndex((s) => s.name.toLowerCase() === "instagram");
    expect(github).toBeGreaterThanOrEqual(0);
    expect(github).toBeLessThan(120);
    if (insta >= 0) expect(github).toBeLessThan(insta);
    const dummy = {
      name: "Instagram",
      uri_check: "https://instagram.com/{account}",
      e_code: 200,
      e_string: "x",
      m_code: 404,
      m_string: "y",
      cat: "social",
    };
    expect(isChronicBlockedHandle(dummy)).toBe(true);
    expect(sitesForScan(false, { profile: "lean" }).some((s) => s.name.toLowerCase() === "instagram")).toBe(false);
  });
});
