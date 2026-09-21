import dns from "node:dns/promises";
import type { ScanProfile } from "../shared/scan-limits.ts";
import type { DnsHistoryRecord, HostCt } from "../shared/types.ts";
import { fetchPublic } from "./http.ts";

export function hostOpenLinks(domain: string): { label: string; url: string }[] {
  const q = encodeURIComponent(domain);
  return [
    { label: "RDAP.org", url: `https://rdap.org/domain/${q}` },
    { label: "crt.sh", url: `https://crt.sh/?q=${q}` },
    { label: "crt.sh JSON", url: `https://crt.sh/?q=${q}&output=json` },
    { label: "Cert Spotter", url: `https://api.certspotter.com/v1/issuances?domain=${q}&include_subdomains=true&expand=dns_names` },
    { label: "urlscan", url: `https://urlscan.io/search/#domain:${q}` },
    { label: "SecurityTrails (search)", url: `https://securitytrails.com/domain/${q}/dns` },
    { label: "ViewDNS (search)", url: `https://viewdns.info/dnsrecord/?domain=${q}` },
    { label: "HackerTarget DNS", url: `https://api.hackertarget.com/dnslookup/?q=${q}` },
  ];
}

export function parseCertSpotter(body: string): HostCt | undefined {
  try {
    const raw = JSON.parse(body) as {
      dns_names?: string[];
      issuer?: { name?: string; friendly_name?: string };
      not_before?: string;
      not_after?: string;
    }[];
    if (!Array.isArray(raw) || !raw.length) return undefined;
    const names = new Set<string>();
    const issuers = new Set<string>();
    let firstSeen: string | undefined;
    let lastSeen: string | undefined;
    for (const row of raw) {
      for (const n of row.dns_names ?? []) {
        const host = n.replace(/^\*\./, "").toLowerCase().trim();
        if (host) names.add(host);
      }
      const iss = row.issuer?.friendly_name || row.issuer?.name;
      if (iss) issuers.add(iss);
      if (row.not_before && (!firstSeen || row.not_before < firstSeen)) firstSeen = row.not_before;
      if (row.not_after && (!lastSeen || row.not_after > lastSeen)) lastSeen = row.not_after;
    }
    return {
      source: "certspotter",
      names: [...names].slice(0, 40),
      issuers: [...issuers].slice(0, 12),
      count: names.size,
      firstSeen,
      lastSeen,
    };
  } catch {
    return undefined;
  }
}

/** Recover names from a truncated crt.sh JSON array (body-limit safe). */
export function parseCrtShPartial(body: string): HostCt | undefined {
  const names = new Set<string>();
  const issuers = new Set<string>();
  const nameRe = /"common_name"\s*:\s*"([^"]{1,253})"/gi;
  const issuerRe = /"issuer_name"\s*:\s*"([^"]{1,300})"/gi;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(body))) {
    names.add(m[1].replace(/^\*\./, "").toLowerCase());
  }
  const cnRe = /"name_value"\s*:\s*"([^"]{1,800})"/gi;
  while ((m = cnRe.exec(body))) {
    for (const part of m[1].split(/\n/)) {
      const host = part.replace(/^\*\./, "").toLowerCase().trim();
      if (host && !host.includes(" ")) names.add(host);
    }
  }
  while ((m = issuerRe.exec(body))) issuers.add(m[1]);
  if (!names.size) return undefined;
  return {
    source: "crt.sh",
    names: [...names].slice(0, 40),
    issuers: [...issuers].slice(0, 12),
    count: names.size,
  };
}

export function parseHackerTargetDns(body: string): DnsHistoryRecord[] {
  const text = body.trim();
  if (!text || /error|exceeded|api count/i.test(text)) return [];
  const out: DnsHistoryRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z]+)\s*:\s*(.+)$/);
    if (!m) continue;
    out.push({ type: m[1], value: m[2].trim() });
    if (out.length >= 40) break;
  }
  return out;
}

export async function lookupPtr(ips: string[], cap = 3): Promise<string[]> {
  const names: string[] = [];
  for (const ip of ips.slice(0, cap)) {
    try {
      const ptr = await dns.reverse(ip);
      for (const n of ptr) {
        if (n && !names.includes(n)) names.push(n);
      }
    } catch {
      /* no PTR */
    }
  }
  return names;
}

export async function fetchCertificateTransparency(
  domain: string,
  profile: ScanProfile,
): Promise<HostCt | undefined> {
  const q = encodeURIComponent(domain);
  if (profile !== "lean") {
    const spotter = await fetchPublic({
      url: `https://api.certspotter.com/v1/issuances?domain=${q}&include_subdomains=true&expand=dns_names`,
      accept: "application/json",
      timeoutMs: 10_000,
    });
    if (spotter.status === 200) {
      const parsed = parseCertSpotter(spotter.body);
      if (parsed?.names.length) return parsed;
    }
  }
  const crt = await fetchPublic({
    url: `https://crt.sh/?q=${q}&output=json`,
    accept: "application/json",
    timeoutMs: 10_000,
  });
  if (crt.status === 200) {
    return parseCrtShPartial(crt.body) ?? parseCertSpotter(crt.body);
  }
  return undefined;
}

export async function fetchPublicDnsHistory(domain: string): Promise<DnsHistoryRecord[]> {
  const res = await fetchPublic({
    url: `https://api.hackertarget.com/dnslookup/?q=${encodeURIComponent(domain)}`,
    accept: "text/plain",
    timeoutMs: 8_000,
  });
  if (res.status !== 200) return [];
  return parseHackerTargetDns(res.body);
}

export function ctSubdomains(ct: HostCt | undefined, apex: string): string[] {
  if (!ct) return [];
  const root = apex.toLowerCase();
  return ct.names
    .filter((n) => n === root || n.endsWith(`.${root}`))
    .filter((n) => n !== root)
    .slice(0, 24);
}
