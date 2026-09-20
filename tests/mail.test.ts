import { describe, expect, it } from "vitest";
import { analyzeLocalPart, detectKind, preflightMail, resolveMode } from "../server/detect.ts";
import { parseDmarc, parseSpf } from "../server/host.ts";
import { mailPivots, sha256Email } from "../server/mail.ts";

const disposable = new Set(["mailinator.com", "yopmail.com"]);

describe("email dossier basics", () => {
  it("detects email vs handle vs host", () => {
    expect(detectKind("octocat")).toBe("handle");
    expect(detectKind("press@github.com")).toBe("mail");
    expect(detectKind("github.com")).toBe("host");
    expect(detectKind("https://github.com")).toBe("host");
    expect(resolveMode("octocat", "mail")).toBe("mail");
  });

  it("flags disposable domains and plus-addressing", () => {
    const r = preflightMail("jobs+osint@mailinator.com", disposable, true);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /disposable/i.test(w))).toBe(true);
    expect(r.notes.some((n) => /plus-address/i.test(n))).toBe(true);
  });

  it("flags role-based local-parts", () => {
    const r = preflightMail("security@example.com", disposable, true);
    expect(r.warnings.some((w) => /role-based/i.test(w))).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(preflightMail("not-an-email", disposable, null).ok).toBe(false);
  });

  it("analyzes first.last and trailing year", () => {
    const a = analyzeLocalPart("ada.lovelace1984");
    expect(a.patterns).toContain("dotted");
    expect(a.patterns).toContain("first.last");
    expect(a.patterns).toContain("trailing-year");
    expect(a.possibleNames[0]).toBe("Ada Lovelace");
    expect(a.trailingYear).toBe("1984");
  });
});

describe("mail pivots and hashes", () => {
  it("builds local-part handle pivots from dotted names", () => {
    const pivots = mailPivots("ada.lovelace1984@example.com");
    expect(pivots).toContain("ada.lovelace1984");
    expect(pivots).toContain("ada.lovelace");
    expect(pivots).toContain("adalovelace");
  });

  it("hashes Gravatar SHA-256 of the normalized address", () => {
    expect(sha256Email("Press@GitHub.com")).toBe(sha256Email("press@github.com"));
    expect(sha256Email("press@github.com")).toHaveLength(64);
  });
});

describe("SPF / DMARC parse", () => {
  it("parses SPF all qualifier", () => {
    const [spf] = parseSpf(["v=spf1 include:_spf.google.com -all"]);
    expect(spf.allQualifier).toBe("-all");
    expect(spf.mechanisms).toContain("include:_spf.google.com");
  });

  it("parses DMARC policy", () => {
    const [d] = parseDmarc(["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"]);
    expect(d.policy).toBe("reject");
    expect(d.rua).toBe("mailto:dmarc@example.com");
  });
});
