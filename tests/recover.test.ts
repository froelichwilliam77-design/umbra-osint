import { describe, expect, it } from "vitest";
import { classifyOracleBody } from "../server/oracles.ts";
import { interpretGenericJson, parseMaybeJson, recoverOracleVerdict } from "../server/mail-oracle-recover.ts";
import { umbraVersion } from "../server/version.ts";
import { loadSchema } from "../server/schema.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function http(status: number, body: string, extra: { location?: string; headers?: Record<string, string> } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://example.com/oracle",
    finalUrl: extra.location ?? "https://example.com/oracle",
    location: extra.location,
    headers: extra.headers ?? {},
    body,
    latencyMs: 1,
  };
}

describe("oracle recovery (escalate → found/miss/blocked)", () => {
  it("maps JSON existence flags", () => {
    expect(interpretGenericJson({ exists: true })?.status).toBe("found");
    expect(interpretGenericJson({ exists: false })?.status).toBe("miss");
    expect(interpretGenericJson({ data: { available: true } })?.status).toBe("miss");
    expect(interpretGenericJson({ data: { available: false } })?.status).toBe("found");
    expect(interpretGenericJson({ users: [] })?.status).toBe("miss");
    expect(interpretGenericJson({ errors: { email: "EMAIL_ALREADY_REGISTERED" } })?.status).toBe("found");
  });

  it("parses JSON with a )]}' XSS prefix", () => {
    expect(parseMaybeJson(")]}',\n{\"exists\":true}")).toEqual({ exists: true });
  });

  it("recovers taken copy as found and signup HTML as miss", () => {
    expect(recoverOracleVerdict(http(200, "That email address is already registered."))?.status).toBe("found");
    expect(
      recoverOracleVerdict(
        http(200, '<html><form><input type="email" name="email"></form><p>Create account</p></html>'),
      )?.status,
    ).toBe("miss");
  });

  it("recovers 401/CSRF as blocked, 404 as miss, 409 as found", () => {
    expect(recoverOracleVerdict(http(401, "unauthorized"))?.status).toBe("blocked");
    expect(recoverOracleVerdict(http(404, "nope"))?.status).toBe("miss");
    expect(recoverOracleVerdict(http(409, "conflict"))?.status).toBe("found");
    expect(recoverOracleVerdict(http(419, "csrf token mismatch"))?.status).toBe("blocked");
    expect(recoverOracleVerdict(http(302, "", { location: "https://example.com/register" }))?.status).toBe("miss");
    expect(recoverOracleVerdict(http(405, "method not allowed"))?.status).toBe("blocked");
    expect(recoverOracleVerdict(http(418, "teapot"))?.status).toBe("blocked");
  });

  it("classifyOracleBody uses recovery instead of unclassified escalate", () => {
    expect(classifyOracleBody(http(200, '{"exists":true}')).status).toBe("found");
    expect(classifyOracleBody(http(200, '{"exists":false}')).status).toBe("miss");
    expect(classifyOracleBody(http(403, "forbidden")).status).toBe("blocked");
  });

  it("health version matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(umbraVersion()).toBe(pkg.version);
    expect(umbraVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("quarantines CSRF-dead oracles instead of probing them", () => {
    const q = loadSchema().oracles.filter((o) => o.quarantine);
    expect(q.map((o) => o.id).sort()).toEqual(
      expect.arrayContaining(["twitter", "facebook", "instagram", "tiktok", "myspace"]),
    );
    expect(q.length).toBeGreaterThanOrEqual(5);
  });
});
