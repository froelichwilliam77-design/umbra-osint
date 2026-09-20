import { describe, expect, it } from "vitest";
import {
  assertSafeUrl,
  isBlockedHostname,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  SsrfError,
} from "../server/ssrf.ts";

describe("SSRF guard", () => {
  it("blocks loopback and RFC1918 IPv4", () => {
    expect(isBlockedIpv4("127.0.0.1")).toBe(true);
    expect(isBlockedIpv4("10.1.2.3")).toBe(true);
    expect(isBlockedIpv4("192.168.1.10")).toBe(true);
    expect(isBlockedIpv4("172.16.0.4")).toBe(true);
    expect(isBlockedIpv4("169.254.169.254")).toBe(true);
    expect(isBlockedIpv4("8.8.8.8")).toBe(false);
  });

  it("blocks IPv6 loopback, link-local, and ULA", () => {
    expect(isBlockedIpv6("::1")).toBe(true);
    expect(isBlockedIpv6("fe80::1")).toBe(true);
    expect(isBlockedIpv6("fd12:3456:789a:1::1")).toBe(true);
    expect(isBlockedIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks localhost and internal hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("foo.internal")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("github.com")).toBe(false);
  });

  it("rejects file/gopher and credentialed URLs", () => {
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SsrfError);
    expect(() => assertSafeUrl("gopher://127.0.0.1/")).toThrow(SsrfError);
    expect(() => assertSafeUrl("https://user:pass@example.com/")).toThrow(SsrfError);
    expect(() => assertSafeUrl("https://127.0.0.1/")).toThrow(SsrfError);
    expect(assertSafeUrl("https://example.com/path").hostname).toBe("example.com");
  });
});
