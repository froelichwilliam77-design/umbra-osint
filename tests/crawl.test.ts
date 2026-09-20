import { describe, expect, it } from "vitest";
import { extractCrawlBody, isBinaryUrl, parseSitemapLocs, resolveCrawlUrl, sameOrigin } from "../server/crawl-extract.ts";
import { detectKind, normalizeQuery, preflightCrawl, resolveMode } from "../server/detect.ts";
import { crawlPageCap } from "../server/limits.ts";
import { assertSafeUrl, SsrfError } from "../server/ssrf.ts";

describe("crawl detect", () => {
  it("treats http(s) URLs and crawl commands as crawl, bare hosts as host", () => {
    expect(detectKind("https://github.com/about")).toBe("crawl");
    expect(detectKind("http://example.com")).toBe("crawl");
    expect(detectKind("crawl this host github.com")).toBe("crawl");
    expect(detectKind("github.com")).toBe("host");
    expect(resolveMode("https://example.com", "crawl")).toBe("crawl");
    expect(normalizeQuery("crawl this host example.com/path", "crawl")).toBe("https://example.com/path");
  });

  it("preflight blocks loopback and private seeds", () => {
    expect(preflightCrawl("https://127.0.0.1/").ok).toBe(false);
    expect(preflightCrawl("https://192.168.0.4/admin").ok).toBe(false);
    expect(preflightCrawl("https://example.com/docs").ok).toBe(true);
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data")).toThrow(SsrfError);
  });
});

describe("crawl extract", () => {
  it("harvests emails, usernames, and same-origin links", () => {
    const html = `<html><head><title>Northline</title></head><body>
      Contact <a href="mailto:press@northline.example">press</a> or ada@northline.example
      Follow <a href="/team">team</a> and https://northline.example/research
      github.com path <a href="https://github.com/octocat">octocat</a>
      Hello @strand_bot on the page.
      <a href="https://evil.example/out">leave</a>
    </body></html>`;
    const out = extractCrawlBody(html, "https://northline.example/");
    expect(out.title).toBe("Northline");
    expect(out.emails).toEqual(expect.arrayContaining(["press@northline.example", "ada@northline.example"]));
    expect(out.usernames).toEqual(expect.arrayContaining(["octocat", "strand_bot"]));
    expect(out.links.some((l) => l.includes("northline.example/team"))).toBe(true);
    expect(sameOrigin("https://northline.example/team", "https://northline.example")).toBe(true);
    expect(sameOrigin("https://evil.example/out", "https://northline.example")).toBe(false);
  });

  it("skips binaries and parses sitemap locs", () => {
    expect(isBinaryUrl("https://example.com/a.pdf")).toBe(true);
    expect(isBinaryUrl("https://example.com/about")).toBe(false);
    expect(parseSitemapLocs("<urlset><url><loc>https://example.com/a</loc></url></urlset>")).toEqual([
      "https://example.com/a",
    ]);
    expect(resolveCrawlUrl("javascript:alert(1)", "https://example.com")).toBeNull();
  });

  it("caps lean crawl pages at 25 by default", () => {
    delete process.env.UMBRA_POWER;
    delete process.env.UMBRA_PROFILE;
    delete process.env.UMBRA_CRAWL_PAGES;
    expect(crawlPageCap("lean")).toBe(25);
  });
});
