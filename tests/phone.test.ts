import { describe, expect, it } from "vitest";
import { detectKind, normalizeQuery, resolveMode } from "../server/detect.ts";
import { looksLikePhone, normalizePhone, parsePhone, preflightPhone } from "../server/phone.ts";

describe("phone detection and E.164", () => {
  it("detects E.164 and formatted US numbers as phone, not handle", () => {
    expect(looksLikePhone("+14155552671")).toBe(true);
    expect(looksLikePhone("+1 415 555 2671")).toBe(true);
    expect(looksLikePhone("(415) 555-2671")).toBe(true);
    expect(looksLikePhone("octocat")).toBe(false);
    expect(looksLikePhone("press@github.com")).toBe(false);
    expect(detectKind("+14155552671")).toBe("phone");
    expect(detectKind("octocat")).toBe("handle");
    expect(resolveMode("+14155552671", "auto")).toBe("phone");
    expect(resolveMode("octocat", "phone")).toBe("phone");
  });

  it("normalizes to E.164 and reports region/type hints", () => {
    expect(normalizePhone("+1 415-555-2671")).toBe("+14155552671");
    expect(normalizeQuery("(415) 555-2671", "phone")).toBe("+14155552671");
    const parsed = parsePhone("+14155552671");
    expect(parsed?.isValid()).toBe(true);
    expect(parsed?.country).toBe("US");
    expect(parsed?.getType()).toBe("FIXED_LINE_OR_MOBILE");
    const pf = preflightPhone("+14155552671");
    expect(pf.ok).toBe(true);
    expect(pf.notes.some((n) => /E\.164/i.test(n))).toBe(true);
    expect(pf.notes.some((n) => /SMS/i.test(n))).toBe(true);
  });

  it("builds public lookup pivots without sending SMS", async () => {
    const { buildPhoneDossier, phoneOpenLinks } = await import("../server/phone.ts");
    const links = phoneOpenLinks("+14155552671", "US");
    expect(links.some((l) => l.label === "Truecaller")).toBe(true);
    expect(links.some((l) => l.label === "WhatsApp" && l.url.includes("wa.me"))).toBe(true);
    expect(links.every((l) => !/sms:|twilio\.com\/.*Messages/i.test(l.url))).toBe(true);
    const d = await buildPhoneDossier("+14155552671");
    expect(d.e164).toBe("+14155552671");
    expect(d.openLinks.length).toBeGreaterThan(3);
    expect(d.peopleLinks?.length).toBeGreaterThan(0);
    expect(d.timezones.length).toBeGreaterThan(0);
    expect(d.regionHint).toMatch(/United States|San Francisco/i);
  });

  it("rejects obviously impossible numbers", () => {
    expect(preflightPhone("+1").ok).toBe(false);
    expect(looksLikePhone("911")).toBe(false);
  });
});
