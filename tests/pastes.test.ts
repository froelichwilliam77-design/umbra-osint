import { describe, expect, it } from "vitest";
import { extractPasteUrls, pasteSearchLinks, pasteSearchQueries, emptyPasteDossier } from "../server/pastes.ts";

describe("public paste harvest", () => {
  it("extracts public paste URLs and ignores private marketplaces", () => {
    const text = `
      https://pastebin.com/abc12345 leaked
      https://gist.github.com/octocat/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      https://rentry.co/hello
      https://darkmarket.example/buy/dumps
    `;
    const hits = extractPasteUrls(text);
    expect(hits.some((h) => h.site === "Pastebin")).toBe(true);
    expect(hits.some((h) => h.site === "GitHub Gist")).toBe(true);
    expect(hits.some((h) => h.site === "rentry")).toBe(true);
    expect(hits.every((h) => !/darkmarket/i.test(h.url))).toBe(true);
  });

  it("offers Google/DDG dorks without requiring a HIBP key", () => {
    const links = pasteSearchLinks("press@github.com");
    expect(links.some((l) => /pastebin/i.test(l.url))).toBe(true);
    expect(links.some((l) => l.label === "GitHub gists")).toBe(true);
    expect(pasteSearchQueries("octocat", "lean").length).toBeLessThan(pasteSearchQueries("octocat", "full").length);
    expect(emptyPasteDossier("octocat").hits).toEqual([]);
    expect(emptyPasteDossier("octocat").disclaimer).toMatch(/public paste/i);
  });
});
