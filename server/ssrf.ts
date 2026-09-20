import { isIP } from "node:net";
import dns from "node:dns/promises";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host.endsWith(".home") || host.endsWith(".lan") || host.endsWith(".corp")) {
    return true;
  }
  return false;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isBlockedIpv4(ip: string): boolean {
  const ranges = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "255.255.255.255/32",
  ];
  return ranges.some((c) => inCidr(ip, c));
}

export function isBlockedIpv6(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::" || n === "::1") return true;
  if (n.startsWith("fe80:") || n.startsWith("fec0:") || n.startsWith("fc") || n.startsWith("fd")) {
    return true;
  }
  if (n.startsWith("ff")) return true;
  const mapped = n.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Blocked protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with credentials are not allowed.");
  }
  if (url.hostname === "" || url.hostname === "[" || url.hostname.includes("%")) {
    throw new SsrfError("Invalid hostname.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new SsrfError(`Blocked hostname: ${url.hostname}`);
  }
  if (isIP(url.hostname) && isBlockedIp(url.hostname)) {
    throw new SsrfError(`Blocked address: ${url.hostname}`);
  }
  return url;
}

export async function resolvePublic(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SsrfError(`Blocked address: ${hostname}`);
    return [hostname];
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SsrfError(`DNS failed for ${hostname}: ${msg}`);
  }
  if (records.length === 0) {
    throw new SsrfError(`No DNS records for ${hostname}`);
  }
  const addrs = records.map((r) => r.address);
  const blocked = addrs.filter(isBlockedIp);
  if (blocked.length) {
    throw new SsrfError(`Hostname ${hostname} resolves to blocked address(es): ${blocked.join(", ")}`);
  }
  return addrs;
}

export async function assertSafeFetchTarget(raw: string): Promise<URL> {
  const url = assertSafeUrl(raw);
  await resolvePublic(url.hostname);
  return url;
}
