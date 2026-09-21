import { describe, expect, it } from "vitest";
import { attachReverseImageToRow, reverseImageLinks, reverseImageUploadLinks } from "../server/reverse-image.ts";
import type { LedgerRow } from "../shared/types.ts";

describe("reverse image search URLs", () => {
  it("builds Lens / Yandex / TinEye search-by-url links", () => {
    const links = reverseImageLinks("https://avatars.githubusercontent.com/u/583231?v=4");
    expect(links.map((l) => l.engine)).toEqual(expect.arrayContaining(["Google Lens", "Yandex", "TinEye"]));
    expect(links.every((l) => l.url.startsWith("https://"))).toBe(true);
    expect(links[0].url).toContain("lens.google.com");
    expect(links.find((l) => l.engine === "Yandex")?.url).toContain("yandex.com/images");
    expect(links.find((l) => l.engine === "TinEye")?.url).toContain("tineye.com/search");
  });

  it("ignores non-http avatars and offers upload engines instead", () => {
    expect(reverseImageLinks("data:image/png;base64,xx")).toEqual([]);
    expect(reverseImageUploadLinks().some((l) => /lens\.google\.com\/upload/.test(l.url))).toBe(true);
  });

  it("attaches reverse links onto found rows with avatars", () => {
    const row: LedgerRow = {
      id: "r1",
      scanId: "s",
      mode: "handle",
      target: "octocat",
      site: "GitHub",
      category: "coding",
      status: "found",
      reason: "ok",
      url: "https://github.com/octocat",
      method: "GET",
      metadata: { avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4" },
    };
    const links = attachReverseImageToRow(row);
    expect(links.length).toBeGreaterThan(2);
    expect(row.metadata?.reverseImage?.length).toBe(links.length);
    expect(row.metadata?.extra?.reverseLens).toMatch(/lens\.google/);
  });
});
