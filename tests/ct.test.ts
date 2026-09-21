import { describe, expect, it } from "vitest";
import { parseCertSpotter, parseCrtShPartial, parseHackerTargetDns, hostOpenLinks, ctSubdomains } from "../server/ct.ts";

describe("domain depth parsers", () => {
  it("parses Cert Spotter issuances JSON", () => {
    const ct = parseCertSpotter(
      JSON.stringify([
        {
          dns_names: ["github.com", "*.github.com", "www.github.com"],
          issuer: { friendly_name: "Let's Encrypt" },
          not_before: "2020-01-01T00:00:00Z",
          not_after: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    expect(ct?.source).toBe("certspotter");
    expect(ct?.names).toEqual(expect.arrayContaining(["github.com", "www.github.com"]));
    expect(ct?.issuers).toContain("Let's Encrypt");
    expect(ctSubdomains(ct, "github.com")).toContain("www.github.com");
  });

  it("recovers crt.sh names from truncated JSON", () => {
    const body = `[{"issuer_name":"C=US","name_value":"github.com\nwww.github.com","common_name":"github.com"},{"common_name":"api.github.com"`;
    const ct = parseCrtShPartial(body);
    expect(ct?.names).toEqual(expect.arrayContaining(["github.com", "www.github.com", "api.github.com"]));
  });

  it("parses HackerTarget DNS text and ignores quota errors", () => {
    const recs = parseHackerTargetDns("A : 140.82.112.3\nMX : 1 aspmx.l.google.com\nNS : dns1.p08.nsone.net");
    expect(recs).toHaveLength(3);
    expect(recs[0]).toEqual({ type: "A", value: "140.82.112.3" });
    expect(parseHackerTargetDns("error: API count exceeded")).toEqual([]);
  });

  it("exposes public RDAP / crt.sh / urlscan links", () => {
    const links = hostOpenLinks("github.com");
    expect(links.some((l) => l.url.includes("rdap.org/domain/github.com"))).toBe(true);
    expect(links.some((l) => l.url.includes("crt.sh/?q="))).toBe(true);
    expect(links.every((l) => l.url.startsWith("https://"))).toBe(true);
  });
});
