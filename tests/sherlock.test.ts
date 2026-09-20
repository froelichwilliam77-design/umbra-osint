import { describe, expect, it } from "vitest";
import { mergeSherlockSites, sherlockToWmn } from "../server/sherlock.ts";
import { loadSchema, schemaStats, sitesForScan } from "../server/schema.ts";

describe("Sherlock overlay", () => {
  it("converts status_code and message sites to dual-condition WMN records", () => {
    const status = sherlockToWmn("Slides", {
      errorType: "status_code",
      errorCode: 204,
      url: "https://slides.com/{}",
    });
    expect(status?.uri_check).toBe("https://slides.com/{account}");
    expect(status?.e_code).toBe(200);
    expect(status?.m_code).toBe(204);

    const msg = sherlockToWmn("1337x", {
      errorType: "message",
      errorMsg: ["<title>Error something went wrong.</title>", "short"],
      url: "https://www.1337x.to/user/{}/",
    });
    expect(msg?.m_string).toContain("Error something went wrong");
    expect(msg?.e_code).toBe(200);
  });

  it("skips names and URL keys already in the base registry", () => {
    const { added, skipped, sites } = mergeSherlockSites(
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
        GitHub: { errorType: "status_code", url: "https://github.com/{}" },
        UniqueSite: { errorType: "status_code", errorCode: 404, url: "https://unique.example/{}" },
      },
    );
    expect(added).toBe(1);
    expect(skipped).toBe(1);
    expect(sites[0].name).toBe("UniqueSite");
    expect(sites[0].source).toBe("sherlock");
  });

  it("lands in the 400–900+ handle-site band with NSFW still optional", () => {
    const stats = schemaStats();
    expect(stats.handleSites).toBeGreaterThanOrEqual(400);
    expect(stats.handleSites).toBeGreaterThan(900);
    expect(stats.sherlockSites).toBeGreaterThan(200);
    expect(sitesForScan(false).length).toBeLessThanOrEqual(loadSchema().sites.length);
  });
});
