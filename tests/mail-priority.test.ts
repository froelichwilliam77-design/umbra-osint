import { afterEach, describe, expect, it } from "vitest";
import { HIGH_SIGNAL_ORACLES, LEAN_SKIP_ORACLES, oraclePriority, selectMailOracles } from "../server/mail-priority.ts";
import { loadSchema } from "../server/schema.ts";
import { mailScanSiteCount } from "../server/mail.ts";

describe("mail oracle priority + lean skip", () => {
  const oracles = loadSchema().oracles;

  it("ranks GitHub / Microsoft / Gravatar / Discord ahead of CRM filler", () => {
    const github = oracles.find((o) => o.id === "github")!;
    const microsoft = oracles.find((o) => o.id === "microsoft")!;
    const gravatar = oracles.find((o) => o.id === "gravatar")!;
    const discord = oracles.find((o) => o.id === "discord")!;
    const crm = oracles.find((o) => o.id === "amocrm")!;
    expect(oraclePriority(github)).toBe(0);
    expect(oraclePriority(microsoft)).toBe(0);
    expect(oraclePriority(gravatar)).toBe(0);
    expect(oraclePriority(discord)).toBe(0);
    expect(oraclePriority(crm)).toBe(2);
    expect(HIGH_SIGNAL_ORACLES.has("github")).toBe(true);
  });

  it("skips quarantined and chronically blocked oracles on lean", () => {
    const lean = selectMailOracles(oracles, { profile: "lean", hibpKey: false });
    const full = selectMailOracles(oracles, { profile: "full", hibpKey: false });
    expect(lean.every((o) => !o.quarantine)).toBe(true);
    expect(lean.every((o) => !LEAN_SKIP_ORACLES.has(o.id))).toBe(true);
    expect(lean.some((o) => o.id === "github")).toBe(true);
    expect(lean.some((o) => o.id === "twitter")).toBe(false);
    expect(lean.some((o) => o.id === "amocrm")).toBe(false);
    expect(full.some((o) => o.id === "twitter")).toBe(true);
    expect(lean.length).toBeLessThan(full.length);
    expect(lean[0].id).toBeDefined();
    const leanIds = lean.map((o) => o.id);
    expect(leanIds.indexOf("github")).toBeLessThan(leanIds.indexOf("calendly") === -1 ? lean.length : leanIds.indexOf("calendly"));
  });

  it("omits HIBP unless a key is present", () => {
    expect(selectMailOracles(oracles, { profile: "lean", hibpKey: false }).some((o) => o.handler === "hibp")).toBe(false);
    expect(selectMailOracles(oracles, { profile: "lean", hibpKey: true }).some((o) => o.handler === "hibp")).toBe(true);
  });

  it("lean mail site count is smaller than full", () => {
    expect(mailScanSiteCount("lean")).toBeLessThan(mailScanSiteCount("full"));
    expect(mailScanSiteCount("lean")).toBeGreaterThan(40);
  });
});
