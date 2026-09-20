import { describe, expect, it } from "vitest";
import {
  classifyResponse,
  detectWaf,
  dualCondition,
  handleAllowed,
  redirectOffProfile,
} from "../server/classify.ts";

const spec = {
  e_code: 200,
  e_string: '"login":',
  m_code: 404,
  m_string: "Not Found",
};

describe("dualCondition", () => {
  it("matches found when status and body both hit", () => {
    expect(dualCondition(spec, 200, '{"login":"octocat"}')).toEqual({
      existHit: true,
      missHit: false,
    });
  });

  it("matches miss when missing status and body both hit", () => {
    expect(dualCondition(spec, 404, "Not Found")).toEqual({
      existHit: false,
      missHit: true,
    });
  });

  it("treats empty e_string as ignore-body", () => {
    expect(dualCondition({ ...spec, e_string: "" }, 200, "anything")).toEqual({
      existHit: true,
      missHit: false,
    });
  });

  it("escalates when both conditions match", () => {
    const both = { e_code: 200, e_string: "user", m_code: 200, m_string: "user" };
    expect(dualCondition(both, 200, "user")).toEqual({ existHit: true, missHit: true });
  });
});

describe("classifyResponse", () => {
  it("never treats 403 as a miss", () => {
    const r = classifyResponse(spec, {
      status: 403,
      body: "Not Found",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(r.status).toBe("blocked");
    expect(r.waf).toBe(true);
  });

  it("never treats 429 as a miss", () => {
    const r = classifyResponse(spec, {
      status: 429,
      body: "Not Found",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(r.status).toBe("blocked");
  });

  it("blocks CAPTCHA / WAF body even on 200", () => {
    const r = classifyResponse(spec, {
      status: 200,
      body: "Just a moment... checking your browser before you proceed",
      headers: { server: "cloudflare" },
      requestedUrl: "https://example.com/octocat",
    });
    expect(r.status).toBe("blocked");
  });

  it("classifies login redirects as miss with reason", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: "profile", m_code: 302, m_string: "" },
      {
        status: 302,
        body: "",
        headers: {},
        requestedUrl: "https://example.com/u/octocat",
        location: "https://example.com/login",
      },
    );
    expect(r.status).toBe("miss");
    expect(r.reason.toLowerCase()).toMatch(/login/);
  });

  it("returns found on exist match", () => {
    const r = classifyResponse(spec, {
      status: 200,
      body: '{"login":"octocat"}',
      headers: {},
      requestedUrl: "https://api.github.com/users/octocat",
    });
    expect(r.status).toBe("found");
  });

  it("returns escalate when neither side matches", () => {
    const r = classifyResponse(spec, {
      status: 418,
      body: "teapot",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(r.status).toBe("escalate");
  });

  it("treats HTTP 401 as blocked, not miss or escalate", () => {
    const r = classifyResponse(spec, {
      status: 401,
      body: "login required",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(r.status).toBe("blocked");
  });

  it("resolves Keybase-style exist substring of missing-string as miss", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: '"them":', m_code: 200, m_string: '"them":null' },
      {
        status: 200,
        body: '{"status":{"code":0},"them":null}',
        headers: {},
        requestedUrl: "https://keybase.io/_/api/1.0/user/lookup.json?username=nope",
        account: "nope",
      },
    );
    expect(r.status).toBe("miss");
  });

  it("recovers exist body when the status code drifted (e_code 200, got 201)", () => {
    const r = classifyResponse(spec, {
      status: 201,
      body: '{"login":"octocat"}',
      headers: {},
      requestedUrl: "https://api.github.com/users/octocat",
    });
    expect(r.status).toBe("found");
  });

  it("treats leftover 3xx as miss and 406/999 as blocked", () => {
    const redir = classifyResponse(spec, {
      status: 301,
      body: "",
      headers: {},
      requestedUrl: "https://example.com/octocat",
      location: "https://elsewhere.example/foo",
    });
    const blocked = classifyResponse(spec, {
      status: 406,
      body: "not acceptable",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(redir.status).toBe("miss");
    expect(blocked.status).toBe("blocked");
  });

  it("treats HTTP 404 as miss even when missing-string drifted", () => {
    const r = classifyResponse(spec, {
      status: 404,
      body: '{"error": 404}',
      headers: {},
      requestedUrl: "https://www.reddit.com/user/nope/about.json",
    });
    expect(r.status).toBe("miss");
    expect(r.reason).toMatch(/404/);
  });

  it("treats HTTP 410 as miss, 451 as blocked", () => {
    const gone = classifyResponse(spec, {
      status: 410,
      body: "gone",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    const legal = classifyResponse(spec, {
      status: 451,
      body: "unavailable",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(gone.status).toBe("miss");
    expect(legal.status).toBe("blocked");
  });

  it("recovers a found from JSON username when e_string is stale", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: '"obsolete_marker"', m_code: 404, m_string: "Not Found" },
      {
        status: 200,
        body: '{"login":"octocat","id":1}',
        headers: {},
        requestedUrl: "https://api.github.com/users/octocat",
        account: "octocat",
      },
    );
    expect(r.status).toBe("found");
    expect(r.reason.toLowerCase()).toMatch(/json/);
  });

  it("recovers HTML profile titles that name the account", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: '"obsolete"', m_code: 404, m_string: "Not Found" },
      {
        status: 200,
        body: '<html><head><title>octocat on Launchpad</title></head><a href="/~octocat">octocat</a>',
        headers: {},
        requestedUrl: "https://api.launchpad.net/1.0/~octocat",
        account: "octocat",
      },
    );
    expect(r.status).toBe("found");
  });

  it("blocks bot-check interstitials that are not 403", () => {
    const r = classifyResponse(spec, {
      status: 200,
      body: "<title>Making sure you're not a bot!</title>",
      headers: {},
      requestedUrl: "https://example.com/octocat",
    });
    expect(r.status).toBe("blocked");
  });

  it("treats empty JSON collections on 200 as miss", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: '"id":', m_code: 200, m_string: "nope" },
      {
        status: 200,
        body: "[]",
        headers: {},
        requestedUrl: "https://gitlab.com/api/v4/users?username=nope",
      },
    );
    expect(r.status).toBe("miss");
  });
});

describe("detectWaf / redirect helpers", () => {
  it("does not treat a normal Cloudflare 200 as blocked", () => {
    expect(
      detectWaf({
        status: 200,
        body: '{"id":1,"username":"octocat"}',
        headers: { "cf-ray": "abc", server: "cloudflare" },
      }),
    ).toBeNull();
  });

  it("flags cf-mitigated and challenge interstitials", () => {
    expect(detectWaf({ status: 403, body: "ok", headers: { "cf-mitigated": "challenge" } })).toMatch(/403|challenge/i);
    expect(
      detectWaf({
        status: 200,
        body: "Just a moment... attention required",
        headers: { "cf-ray": "abc" },
      }),
    ).toMatch(/challenge/i);
  });

  it("detects explore redirects", () => {
    expect(
      redirectOffProfile("https://x.com/octocat", "https://x.com/explore"),
    ).toMatch(/explore/);
  });
});

describe("soft-404 / case-insensitive / regex / redirect-as-evidence", () => {
  it("treats HTTP 200 + missing-profile copy as miss when e_string is empty", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: "", m_code: 404, m_string: "Not Found" },
      {
        status: 200,
        body: "<h1>Sorry, this page isn't available.</h1>",
        headers: {},
        requestedUrl: "https://example.com/octocat",
      },
    );
    expect(r.status).toBe("miss");
    expect(r.reason.toLowerCase()).toMatch(/soft-404/);
  });

  it("matches e_string case-insensitively", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: '"Login":', m_code: 404, m_string: "not found" },
      {
        status: 200,
        body: '{"login":"octocat"}',
        headers: {},
        requestedUrl: "https://api.example.com/users/octocat",
      },
    );
    expect(r.status).toBe("found");
  });

  it("matches JSON missing-strings despite whitespace drift", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: '"id":', m_code: 404, m_string: '"error":404' },
      {
        status: 404,
        body: '{"message": "Not Found", "error": 404}',
        headers: {},
        requestedUrl: "https://www.reddit.com/user/nope/about.json",
      },
    );
    expect(r.status).toBe("miss");
    expect(r.missHit).toBe(true);
  });

  it("skips handles that fail the site username regex", () => {
    expect(handleAllowed("octocat", "^[A-Za-z0-9_]{1,15}$").ok).toBe(true);
    expect(handleAllowed("this-name-is-way-too-long", "^[A-Za-z0-9_]{1,15}$").ok).toBe(false);
  });

  it("treats a 302 that still points at /{account} as found", () => {
    const r = classifyResponse(
      { e_code: 200, e_string: "profile", m_code: 404, m_string: "missing" },
      {
        status: 302,
        body: "",
        headers: {},
        requestedUrl: "https://example.com/u/octocat",
        location: "https://example.com/u/octocat/",
        account: "octocat",
      },
    );
    expect(r.status).toBe("found");
    expect(r.reason.toLowerCase()).toMatch(/profile/);
  });
});
