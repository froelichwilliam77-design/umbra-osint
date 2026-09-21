import { describe, expect, it } from "vitest";
import { classifyResponse, detectWaf, jsonAccountEvidence } from "../server/classify.ts";
import { isWafHeavy } from "../server/curl-impersonate.ts";
import { handlers } from "../server/mail-oracles.ts";
import { HIGH_SIGNAL_ORACLES, selectMailOracles } from "../server/mail-priority.ts";
import {
  isRedditHost,
  isRedditProfileJson,
  redditAlternateUrl,
  redditNeedsRetry,
} from "../server/reddit.ts";
import { loadSchema, sitesForScan } from "../server/schema.ts";

const redditSpec = {
  e_code: 200,
  e_string: '"kind": "t2"',
  m_code: 404,
  m_string: '"error": 404',
};

describe("Reddit coverage", () => {
  it("is in lean and FULL with /user/ pretty URL", () => {
    const lean = sitesForScan(false, { profile: "lean" });
    const full = sitesForScan(false, { profile: "full" });
    const site = lean.find((s) => s.name === "Reddit");
    expect(site).toBeTruthy();
    expect(site?.uri_check).toContain("reddit.com/user/{account}/about.json");
    expect(site?.uri_pretty).toBe("https://www.reddit.com/user/{account}");
    expect(site?.cat).toBe("social");
    expect(full.some((s) => s.name === "Reddit")).toBe(true);
  });

  it("classifies t2 about.json as found and 404 JSON as miss", () => {
    const found = classifyResponse(redditSpec, {
      status: 200,
      body: '{"kind": "t2", "data": {"name": "spez", "id": "1wnj", "total_karma": 1}}',
      headers: {},
      requestedUrl: "https://www.reddit.com/user/spez/about.json",
      account: "spez",
    });
    expect(found.status).toBe("found");
    expect(jsonAccountEvidence('{"kind":"t2","data":{"name":"spez","id":"1wnj"}}', "spez")).toBe(true);
    expect(isRedditProfileJson('{"kind":"t2","data":{"name":"spez"}}', "spez")).toBe(true);

    const miss = classifyResponse(redditSpec, {
      status: 404,
      body: '{"message": "Not Found", "error": 404}',
      headers: {},
      requestedUrl: "https://www.reddit.com/user/nope/about.json",
      account: "nope",
    });
    expect(miss.status).toBe("miss");
    expect(detectWaf({ status: 404, body: '{"message": "Not Found", "error": 404}', headers: {} })).toBeNull();

    const forbiddenMiss = classifyResponse(redditSpec, {
      status: 403,
      body: '{"message": "Not Found", "error": 404}',
      headers: {},
      requestedUrl: "https://www.reddit.com/user/nope/about.json",
      account: "nope",
    });
    expect(forbiddenMiss.status).toBe("miss");
  });

  it("keeps scraper interstitials blocked, not miss", () => {
    const r = classifyResponse(redditSpec, {
      status: 403,
      body: "<html><title>whoa there, pardner!</title></html>",
      headers: {},
      requestedUrl: "https://www.reddit.com/user/spez/about.json",
      account: "spez",
    });
    expect(r.status).toBe("blocked");
  });

  it("treats reddit.com as WAF-heavy for Power TLS impersonation", () => {
    expect(isWafHeavy({ url: "https://www.reddit.com/user/spez/about.json" })).toBe(true);
    expect(isWafHeavy({ url: "https://old.reddit.com/user/spez/about.json" })).toBe(true);
    expect(isWafHeavy({ url: "https://github.com/octocat" })).toBe(false);
  });

  it("swaps www ↔ old.reddit.com when www soft-blocks", () => {
    expect(isRedditHost("https://www.reddit.com/user/spez/about.json")).toBe(true);
    expect(redditAlternateUrl("https://www.reddit.com/user/spez/about.json")).toBe(
      "https://old.reddit.com/user/spez/about.json",
    );
    expect(redditAlternateUrl("https://old.reddit.com/user/spez/about.json")).toBe(
      "https://www.reddit.com/user/spez/about.json",
    );
    expect(redditNeedsRetry({ status: 403, body: "whoa there" })).toBe(true);
    expect(redditNeedsRetry({ status: 200, body: '{"kind":"t2"}' })).toBe(false);
  });

  it("keeps the silent Reddit register email check (no SMTP to subject)", () => {
    expect(HIGH_SIGNAL_ORACLES.has("reddit")).toBe(true);
    expect(handlers.reddit).toBeTypeOf("function");
    const lean = selectMailOracles(loadSchema().oracles, { profile: "lean", hibpKey: false });
    expect(lean.some((o) => o.id === "reddit")).toBe(true);
  });
});
