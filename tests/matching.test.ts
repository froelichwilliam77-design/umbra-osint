import { describe, expect, it } from "vitest";
import { classifyResponse } from "../server/classify.ts";
import { preflightHandle } from "../server/detect.ts";
import { materialize } from "../server/handle.ts";

describe("handle preflight", () => {
  it("accepts octocat", () => {
    const r = preflightHandle("octocat", new Set());
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe("octocat");
  });

  it("rejects illegal characters and length", () => {
    expect(preflightHandle("bad handle!", new Set()).ok).toBe(false);
    expect(preflightHandle("", new Set()).ok).toBe(false);
    expect(preflightHandle("a".repeat(80), new Set()).ok).toBe(false);
    expect(preflightHandle(".hidden", new Set()).ok).toBe(false);
  });
});

describe("site materialize + dual matching", () => {
  it("substitutes {account} in URL, pretty URL, and POST body", () => {
    const m = materialize(
      {
        name: "Demo",
        uri_check: "https://example.com/u/{account}",
        uri_pretty: "https://example.com/@{account}",
        e_code: 200,
        e_string: "ok",
        m_code: 404,
        m_string: "no",
        cat: "coding",
        post_body: '{"username":"{account}"}',
        headers: { "X-User": "{account}" },
      },
      "octocat",
    );
    expect(m.url).toBe("https://example.com/u/octocat");
    expect(m.pretty).toBe("https://example.com/@octocat");
    expect(m.method).toBe("POST");
    expect(m.body).toBe('{"username":"octocat"}');
    expect(m.headers?.["X-User"]).toBe("octocat");
  });

  it("GitHub-style API: 200 + login is found, 404 is miss", () => {
    const spec = { e_code: 200, e_string: '"login":', m_code: 404, m_string: "Not Found" };
    const found = classifyResponse(spec, {
      status: 200,
      body: '{"login":"octocat","id":1}',
      headers: {},
      requestedUrl: "https://api.github.com/users/octocat",
    });
    const miss = classifyResponse(spec, {
      status: 404,
      body: '{"message":"Not Found"}',
      headers: {},
      requestedUrl: "https://api.github.com/users/nope",
    });
    expect(found.status).toBe("found");
    expect(miss.status).toBe("miss");
  });
});
