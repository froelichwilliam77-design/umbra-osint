import { describe, expect, it } from "vitest";
import { maigretToWmn, mergeMaigretSites } from "../server/maigret.ts";
import { loadSchema, schemaStats, sitesForScan } from "../server/schema.ts";

describe("Maigret overlay", () => {
  it("converts status_code and message sites, swapping {username} for {account}", () => {
    const rec = maigretToWmn("UniqueMaigret", {
      url: "https://unique-maigret.example/{username}",
      checkType: "status_code",
      errors: { httpCode: 404 },
      usernameClaimed: "blue",
    });
    expect(rec?.uri_check).toBe("https://unique-maigret.example/{account}");
    expect(rec?.m_code).toBe(404);
    expect(rec?.source).toBe("maigret");

    const msg = maigretToWmn("MsgSite", {
      url: "https://msg.example/{}",
      checkType: "message",
      absenceStrs: ["not found here", "short"],
      presenseStrs: ["profile of"],
    });
    expect(msg?.m_string).toContain("not found here");
    expect(msg?.e_string).toContain("profile of");
  });

  it("skips disabled sites and URL/name duplicates", () => {
    const { added, skipped } = mergeMaigretSites(
      [
        {
          name: "GitHub",
          uri_check: "https://github.com/{account}",
          e_code: 200,
          e_string: "login",
          m_code: 404,
          m_string: "Not Found",
          cat: "coding",
        },
      ],
      {
        GitHub: { url: "https://github.com/{username}", checkType: "status_code" },
        Dead: { url: "https://dead.example/{username}", disabled: true, checkType: "status_code" },
        Fresh: { url: "https://fresh.example/{username}", checkType: "status_code" },
      },
    );
    expect(added).toBe(1);
    expect(skipped).toBe(2);
  });

  it("FULL map is substantially larger than lean (~250 cap)", () => {
    const stats = schemaStats();
    const full = sitesForScan(false, { profile: "full" });
    const lean = sitesForScan(false, { profile: "lean" });
    expect(lean.length).toBeLessThanOrEqual(300);
    expect(full.length).toBeGreaterThan(lean.length + 200);
    expect(stats.handleSites).toBeGreaterThanOrEqual(full.length);
    expect(loadSchema().sites.length).toBeGreaterThan(900);
  });
});
