import { describe, expect, it } from "vitest";
import { emptyHibp, parseHibpBreaches } from "../server/hibp.ts";

describe("HIBP dossier parser", () => {
  it("parses breach records from the v3 payload", () => {
    const breaches = parseHibpBreaches(
      JSON.stringify([
        {
          Name: "Adobe",
          Title: "Adobe",
          Domain: "adobe.com",
          BreachDate: "2013-10-04",
          PwnCount: 152445165,
          DataClasses: ["Email addresses", "Passwords"],
        },
        { Name: "LinkedIn", Title: "LinkedIn", Domain: "linkedin.com", BreachDate: "2012-05-05" },
      ]),
    );
    expect(breaches).toHaveLength(2);
    expect(breaches[0].name).toBe("Adobe");
    expect(breaches[0].dataClasses).toContain("Email addresses");
    expect(breaches[1].breachDate).toBe("2012-05-05");
  });

  it("returns a skipped dossier when no API key is configured", () => {
    const d = emptyHibp();
    expect(d.enabled).toBe(false);
    expect(d.breachCount).toBe(0);
    expect(d.skipped).toMatch(/HIBP_API_KEY/);
  });
});
