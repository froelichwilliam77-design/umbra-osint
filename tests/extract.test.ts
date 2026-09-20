import { describe, expect, it } from "vitest";
import { extractHtmlMeta, extractJsonLd, extractMetadata, htmlTitle } from "../server/extract.ts";

describe("metadata scrape", () => {
  it("reads Open Graph tags", () => {
    const card = extractHtmlMeta(
      `<html><head>
        <meta property="og:title" content="Ada Lovelace">
        <meta property="og:description" content="Mathematician">
        <meta property="og:image" content="https://example.com/a.png">
        <title>ignored</title>
      </head></html>`,
    );
    expect(card?.displayName).toBe("Ada Lovelace");
    expect(card?.bio).toBe("Mathematician");
    expect(card?.avatarUrl).toBe("https://example.com/a.png");
  });

  it("reads JSON-LD Person", () => {
    const card = extractJsonLd(`<script type="application/ld+json">{"@type":"Person","name":"Octocat","description":"Mascot","image":"https://github.com/octocat.png","url":"https://github.com/octocat"}</script>`);
    expect(card?.displayName).toBe("Octocat");
    expect(card?.bio).toBe("Mascot");
    expect(card?.avatarUrl).toBe("https://github.com/octocat.png");
  });

  it("pulls GitHub extras via extractor", () => {
    const card = extractMetadata(
      "GitHub (User)",
      JSON.stringify({
        login: "octocat",
        name: "The Octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/583231",
        bio: "Mascot",
        followers: 15000,
        following: 9,
        location: "San Francisco",
        blog: "https://github.blog",
        public_repos: 8,
        company: "GitHub",
        html_url: "https://github.com/octocat",
      }),
      [
        {
          site: "GitHub (User)",
          kind: "json",
          avatar: "avatar_url",
          bio: "bio",
          followers: "followers",
          following: "following",
          displayName: "name",
          location: "location",
          website: "blog",
        },
      ],
    );
    expect(card?.displayName).toBe("The Octocat");
    expect(card?.followers).toBe(15000);
    expect(card?.extra?.login).toBe("octocat");
    expect(card?.extra?.public_repos).toBe(8);
  });

  it("reads html title", () => {
    expect(htmlTitle("<title>  GitHub · octocat  </title>")).toBe("GitHub · octocat");
  });
});
