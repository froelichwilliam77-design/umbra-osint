import { describe, expect, it } from "vitest";
import { parseDmarc, parseSecurityTxt, parseSpf } from "../server/host.ts";

describe("host parsers", () => {
  it("parses security.txt contacts and expiry", () => {
    const parsed = parseSecurityTxt(`# comment
Contact: mailto:security@github.com
Contact: https://github.com/security
Expires: 2027-01-01T00:00:00.000Z
Encryption: https://github.com/.well-known/pgp
Policy: https://docs.github.com/en/site-policy
Canonical: https://github.com/.well-known/security.txt
Preferred-Languages: en
`);
    expect(parsed.contact).toEqual(["mailto:security@github.com", "https://github.com/security"]);
    expect(parsed.expires).toMatch(/2027/);
    expect(parsed.policy?.[0]).toContain("site-policy");
    expect(parsed.preferredLanguages).toBe("en");
  });

  it("still parses SPF and DMARC", () => {
    const [spf] = parseSpf(["v=spf1 include:_spf.google.com -all"]);
    expect(spf.allQualifier).toBe("-all");
    const [d] = parseDmarc(["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"]);
    expect(d.policy).toBe("reject");
  });
});
