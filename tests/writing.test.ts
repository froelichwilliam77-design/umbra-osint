import { describe, expect, it } from "vitest";
import { handlers } from "../server/mail-oracles.ts";
import { HIGH_SIGNAL_ORACLES, selectMailOracles } from "../server/mail-priority.ts";
import {
  isHighSignalSite,
  isWritingSite,
  loadSchema,
  sitesForScan,
  type WmnSite,
} from "../server/schema.ts";

const WRITING_LEAN = [
  "Medium",
  "Substack",
  "Hashnode",
  "Dev.to",
  "tumblr",
  "Blogspot",
  "WordPress.com (Public)",
  "Wattpad",
  "Archive of Our Own",
  "write.as",
];

function dummy(partial: Partial<WmnSite> & Pick<WmnSite, "name" | "uri_check">): WmnSite {
  return {
    e_code: 200,
    e_string: "x",
    m_code: 404,
    m_string: "y",
    cat: "misc",
    ...partial,
  };
}

describe("writing / blogging platforms", () => {
  it("treats writing platforms as high-signal and blog-tagged", () => {
    expect(isHighSignalSite(dummy({ name: "Wattpad", uri_check: "https://www.wattpad.com/api/v3/users/{account}" }))).toBe(
      true,
    );
    expect(isHighSignalSite(dummy({ name: "Archive of Our Own", uri_check: "https://archiveofourown.org/users/{account}" }))).toBe(
      true,
    );
    expect(isWritingSite(dummy({ name: "Ghost", uri_check: "https://{account}.ghost.io/", cat: "blog" }))).toBe(true);
    expect(isWritingSite(dummy({ name: "Quotev", uri_check: "https://www.quotev.com/{account}" }))).toBe(true);
  });

  it("keeps core writing sites in the lean map and FULL still larger", () => {
    const lean = sitesForScan(false, { profile: "lean" });
    const full = sitesForScan(false, { profile: "full" });
    const leanNames = new Set(lean.map((s) => s.name));
    for (const name of WRITING_LEAN) {
      expect(leanNames.has(name), `lean missing ${name}`).toBe(true);
      expect(lean.find((s) => s.name === name)?.cat).toBe("blog");
    }
    expect(leanNames.has("FanFiction.net")).toBe(true);
    expect(leanNames.has("Ghost")).toBe(true);
    expect(leanNames.has("Notion site")).toBe(true);
    expect(lean.length).toBeLessThanOrEqual(300);
    expect(full.length).toBeGreaterThan(lean.length);
    expect(full.some((s) => s.name === "Medium")).toBe(true);
  });

  it("does not keep the noisy WordPress.com Deleted duplicate", () => {
    const names = loadSchema().sites.map((s) => s.name);
    expect(names).not.toContain("WordPress.com (Deleted)");
    expect(names).toContain("WordPress.com (Public)");
  });

  it("has silent writing mail oracles (no SMTP handlers) on lean", () => {
    for (const id of ["medium", "wordpress", "tumblr", "hashnode", "substack", "wattpad", "issuu", "scribd", "academia"]) {
      expect(HIGH_SIGNAL_ORACLES.has(id), id).toBe(true);
      expect(handlers[id], id).toBeTypeOf("function");
    }
    const lean = selectMailOracles(loadSchema().oracles, { profile: "lean", hibpKey: false });
    expect(lean.some((o) => o.id === "medium")).toBe(true);
    expect(lean.some((o) => o.id === "wordpress")).toBe(true);
    expect(lean.some((o) => o.id === "scribd")).toBe(true);
    expect(lean.filter((o) => o.category === "blog").length).toBeGreaterThanOrEqual(6);
  });
});
