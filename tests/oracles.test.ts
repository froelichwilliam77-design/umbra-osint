import { describe, expect, it } from "vitest";
import { classifyOracleBody } from "../server/oracles.ts";
import { csrfToken, takenOrAvailable } from "../server/mail-oracle-http.ts";
import { handlers } from "../server/mail-oracles.ts";
import {
  matchAmocrm,
  matchAsana,
  matchBinanceExist,
  matchBodybuildingStatus,
  matchCoroflot,
  matchDiigo,
  matchDiscordRegister,
  matchEbayIdentifer,
  matchEllo,
  matchEvernote,
  matchFacebookAttempt,
  matchGarminValidate,
  matchHudsonRock,
  matchInsightly,
  matchIssuu,
  matchLastpass,
  matchNimble,
  matchNocrm,
  matchRambler,
  matchSnapMerlin,
  matchSteamEmail,
  matchTeamleader,
  matchTellonym,
  matchTakenPhrases,
  matchVoxmedia,
  matchVrbo,
  matchVsco,
  matchWattpad,
} from "../server/mail-oracle-match.ts";
import { loadSchema } from "../server/schema.ts";
import { mailOpenLinks } from "../server/mail-util.ts";

function http(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://example.com/oracle",
    finalUrl: "https://example.com/oracle",
    headers,
    body,
    latencyMs: 1,
  };
}

describe("new oracle matchers (Holehe-style)", () => {
  it("classifies LastPass check=avail no/ok", () => {
    expect(matchLastpass("no")?.status).toBe("found");
    expect(matchLastpass("ok")?.status).toBe("miss");
    expect(matchLastpass("emailinvalid")?.status).toBe("miss");
    expect(matchLastpass("captcha")).toBeNull();
  });

  it("classifies Issuu check-email status", () => {
    expect(matchIssuu({ status: "unavailable" }).status).toBe("found");
    expect(matchIssuu({ status: "available" }).status).toBe("miss");
  });

  it("classifies Teamleader availability", () => {
    expect(matchTeamleader({ available: false }).status).toBe("found");
    expect(matchTeamleader({ available: true }).status).toBe("miss");
  });

  it("classifies Vox Media email_valid", () => {
    expect(matchVoxmedia({ available: true }).status).toBe("miss");
    expect(matchVoxmedia({ available: false }).status).toBe("found");
    expect(matchVoxmedia({ message: "You cannot use this email address." }).status).toBe("miss");
  });

  it("classifies amoCRM used/free", () => {
    expect(matchAmocrm({ status: "used" }).status).toBe("found");
    expect(matchAmocrm({ status: "free" }).status).toBe("miss");
  });

  it("classifies noCRM account flag", () => {
    expect(matchNocrm('{"account":1,"url":"https://x.nocrm.io"}')?.status).toBe("found");
    expect(matchNocrm('{"account":0}')?.status).toBe("miss");
  });

  it("classifies Insightly and Nimble body strings", () => {
    expect(matchInsightly("An account exists for this address. Use another address or")?.status).toBe("found");
    expect(matchInsightly("true")?.status).toBe("miss");
    expect(matchNimble('"I thought you looked familiar! This email is already registered."')?.status).toBe("found");
    expect(matchNimble("true")?.status).toBe("miss");
  });

  it("classifies Coroflot data=-2 as taken", () => {
    expect(matchCoroflot({ data: -2 }).status).toBe("found");
    expect(matchCoroflot({ data: 1 }).status).toBe("miss");
  });

  it("classifies Diigo 0/1", () => {
    expect(matchDiigo("0")?.status).toBe("found");
    expect(matchDiigo("1")?.status).toBe("miss");
  });

  it("classifies Rambler exists flag", () => {
    expect(matchRambler({ result: { exists: 1 } }).status).toBe("found");
    expect(matchRambler({ result: { exists: 0 } }).status).toBe("miss");
  });

  it("classifies Ello availability.email", () => {
    expect(matchEllo({ availability: { email: false } }).status).toBe("found");
    expect(matchEllo({ availability: { email: true } }).status).toBe("miss");
  });

  it("classifies Vrbo authType LOGIN vs SIGNUP", () => {
    expect(matchVrbo({ authType: ["LOGIN_UMS"] }).status).toBe("found");
    expect(matchVrbo({ authType: ["SIGNUP"] }).status).toBe("miss");
  });

  it("classifies eBay identifier err as miss", () => {
    expect(matchEbayIdentifer({ err: "not found" }).status).toBe("miss");
    expect(matchEbayIdentifer({ next: "password" }).status).toBe("found");
  });

  it("classifies Garmin validate true/false", () => {
    expect(matchGarminValidate("false")?.status).toBe("found");
    expect(matchGarminValidate("true")?.status).toBe("miss");
  });

  it("classifies Discord EMAIL_ALREADY_REGISTERED and CAPTCHA", () => {
    expect(
      matchDiscordRegister({
        errors: { email: { _errors: [{ code: "EMAIL_ALREADY_REGISTERED" }] } },
      }).status,
    ).toBe("found");
    expect(matchDiscordRegister({ captcha_key: ["captcha-required"] }).status).toBe("blocked");
  });

  it("classifies Facebook email_is_taken", () => {
    expect(matchFacebookAttempt({ errors: { email: [{ code: "email_is_taken" }] } }).status).toBe("found");
    expect(matchFacebookAttempt({ status: "fail" }).status).toBe("blocked");
  });

  it("classifies Snap merlin flags", () => {
    expect(matchSnapMerlin({ hasSnapchat: true }, "snapchat").status).toBe("found");
    expect(matchSnapMerlin({ hasBitmoji: false }, "bitmoji").status).toBe("miss");
  });

  it("classifies VSCO / Wattpad / Tellonym", () => {
    expect(matchVsco({ email_status: "has_account" }).status).toBe("found");
    expect(matchVsco({ email_status: "no_account" }).status).toBe("miss");
    expect(matchWattpad('{"message":"OK","code":200}')?.status).toBe("miss");
    expect(matchTellonym("EMAIL_ALREADY_IN_USE")?.status).toBe("found");
  });

  it("classifies Evernote usePasswordAuth", () => {
    expect(matchEvernote("usePasswordAuth")?.status).toBe("found");
    expect(matchEvernote("displayMessage")?.status).toBe("miss");
  });

  it("classifies Bodybuilding HEAD 200/404", () => {
    expect(matchBodybuildingStatus(200)?.status).toBe("found");
    expect(matchBodybuildingStatus(404)?.status).toBe("miss");
    expect(matchBodybuildingStatus(403)).toBeNull();
  });
});

describe("extra oracle matchers", () => {
  it("classifies Steam bAvailable", () => {
    expect(matchSteamEmail({ bAvailable: false }).status).toBe("found");
    expect(matchSteamEmail({ bAvailable: true }).status).toBe("miss");
  });

  it("classifies Hudson Rock stealers as found, empty as miss", () => {
    expect(matchHudsonRock({ stealers: [{ date: "2024" }], employees: [], total: 1 }).status).toBe("found");
    expect(matchHudsonRock({ stealers: [], employees: [], total: 0 }).status).toBe("miss");
  });

  it("classifies Asana email_exists", () => {
    expect(matchAsana({ email_exists: true }).status).toBe("found");
    expect(matchAsana({ email_exists: false }).status).toBe("miss");
  });

  it("classifies Binance exist payload", () => {
    expect(matchBinanceExist({ data: true }).status).toBe("found");
    expect(matchBinanceExist({ data: false }).status).toBe("miss");
  });
});

describe("oracle HTTP classification stubs", () => {
  it("treats 403/429 as blocked, never miss", () => {
    expect(classifyOracleBody(http(403, "forbidden")).status).toBe("blocked");
    expect(classifyOracleBody(http(429, "rate limit")).status).toBe("blocked");
  });

  it("treats CAPTCHA body as blocked even on 200", () => {
    expect(classifyOracleBody(http(200, "Just a moment... checking your browser")).status).toBe("blocked");
  });

  it("takenOrAvailable maps match strings without calling the network", () => {
    const found = takenOrAvailable(http(200, "That email is already taken."), "https://example.com", "POST", {
      taken: ["already taken"],
      available: ["ok"],
      foundReason: "taken",
      missReason: "free",
    });
    expect(found.verdict.status).toBe("found");
    const miss = takenOrAvailable(http(200, "ok"), "https://example.com", "POST", {
      taken: ["already taken"],
      available: ["ok"],
      foundReason: "taken",
      missReason: "free",
    });
    expect(miss.verdict.status).toBe("miss");
  });

  it("extracts csrf-token meta tags", () => {
    expect(csrfToken('<meta name="csrf-token" content="abc123">')).toBe("abc123");
  });

  it("generic taken phrases catch Holehe-style copy", () => {
    expect(matchTakenPhrases("Someone is already registered with that email address")?.status).toBe("found");
    expect(matchTakenPhrases("looks fine")).toBeNull();
  });
});

describe("oracle registry expansion", () => {
  it("has a handler for every yaml oracle", () => {
    const missing = loadSchema().oracles.filter((o) => !handlers[o.handler]);
    expect(missing).toEqual([]);
  });

  it("ships well over the v1.2.0 baseline of 53 silent oracles", () => {
    expect(loadSchema().oracles.length).toBeGreaterThan(140);
    expect(Object.keys(handlers).length).toBeGreaterThan(140);
    expect(loadSchema().oracles.filter((o) => o.quarantine).length).toBeGreaterThanOrEqual(5);
  });

  it("mail scan module imports the handler registry", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../server/mail.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import \{ handlers \} from "\.\/mail-oracles\.ts"/);
  });

  it("does not include password-reset handlers", () => {
    const src = Object.keys(handlers).join(" ");
    expect(src).not.toMatch(/forgot|resetPassword|restore_password/i);
  });
});

describe("mail open-in pivots", () => {
  it("builds public OSINT links for an address", () => {
    const links = mailOpenLinks("press@github.com", "abc", "def");
    expect(links.some((l) => l.label === "HIBP")).toBe(true);
    expect(links.some((l) => l.label === "Hudson Rock")).toBe(true);
    expect(links.some((l) => l.label === "Paste search")).toBe(true);
    expect(links.some((l) => l.label === "Gists")).toBe(true);
    expect(links.some((l) => l.label === "Epieos")).toBe(true);
    expect(links.find((l) => l.label === "Gravatar")?.url).toContain("abc");
  });
});
