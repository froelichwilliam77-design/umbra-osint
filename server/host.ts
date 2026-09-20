import dns from "node:dns/promises";
import tls from "node:tls";
import type { DmarcRecord, HostDossier, LedgerRow, SpfRecord } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import { htmlTitle } from "./extract.ts";
import { fetchFollow } from "./http.ts";
import { SsrfError, assertSafeFetchTarget, resolvePublic } from "./ssrf.ts";

async function safeResolve(domain: string, type: "A" | "AAAA" | "MX" | "NS" | "TXT" | "CNAME"): Promise<string[]> {
  try {
    switch (type) {
      case "A":
        return await dns.resolve4(domain);
      case "AAAA":
        return await dns.resolve6(domain);
      case "NS":
        return await dns.resolveNs(domain);
      case "CNAME":
        return await dns.resolveCname(domain);
      case "TXT":
        return (await dns.resolveTxt(domain)).map((p) => p.join(""));
      case "MX":
        return (await dns.resolveMx(domain)).map((m) => `${m.priority} ${m.exchange}`);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

async function resolveSoa(domain: string): Promise<string | undefined> {
  try {
    const soa = await dns.resolveSoa(domain);
    return `${soa.nsname} ${soa.hostmaster} serial ${soa.serial}`;
  } catch {
    return undefined;
  }
}

async function resolveCaa(domain: string): Promise<string[]> {
  try {
    const recs = await dns.resolveCaa(domain);
    return recs.map((c) => {
      if (c.issue) return `${c.critical} issue "${c.issue}"`;
      if (c.issuewild) return `${c.critical} issuewild "${c.issuewild}"`;
      if (c.iodef) return `${c.critical} iodef "${c.iodef}"`;
      return `${c.critical} ${JSON.stringify(c)}`;
    });
  } catch {
    return [];
  }
}

function parseSpf(txts: string[]): SpfRecord[] {
  return txts
    .filter((t) => t.toLowerCase().startsWith("v=spf1"))
    .map((raw) => {
      const mechanisms = raw.split(/\s+/).slice(1);
      const all = mechanisms.find((m) => /all$/i.test(m));
      return { raw, mechanisms, allQualifier: all };
    });
}

function parseDmarc(txts: string[]): DmarcRecord[] {
  return txts
    .filter((t) => t.toLowerCase().startsWith("v=dmarc1"))
    .map((raw) => {
      const parts = Object.fromEntries(
        raw
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            const [k, ...rest] = p.split("=");
            return [k.trim().toLowerCase(), rest.join("=").trim()];
          }),
      );
      return {
        raw,
        policy: parts.p,
        rua: parts.rua,
        ruf: parts.ruf,
        pct: parts.pct,
      };
    });
}

function rdapCandidates(domain: string): string[] {
  const urls = [
    `https://rdap.org/domain/${encodeURIComponent(domain)}`,
    `https://www.rdap.net/domain/${encodeURIComponent(domain)}`,
  ];
  if (domain.endsWith(".com") || domain.endsWith(".net")) {
    const tld = domain.split(".").pop();
    urls.push(`https://rdap.verisign.com/${tld}/v1/domain/${encodeURIComponent(domain)}`);
  }
  return urls;
}

function vcardValue(vcard: unknown[][], key: string): string | undefined {
  const row = vcard.find((r) => Array.isArray(r) && r[0] === key);
  if (!row) return undefined;
  const val = row[3];
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

async function fetchRdap(domain: string): Promise<HostDossier["rdap"]> {
  let res: Awaited<ReturnType<typeof fetchFollow>> | undefined;
  let url = rdapCandidates(domain)[0];
  for (const candidate of rdapCandidates(domain)) {
    url = candidate;
    res = await fetchFollow({ url, accept: "application/rdap+json, application/json" });
    if (res.status === 200 && res.body.trim().startsWith("{")) break;
  }
  if (!res || res.status !== 200) return undefined;
  try {
    const j = JSON.parse(res.body) as {
      handle?: string;
      ldhName?: string;
      status?: string[];
      nameservers?: { ldhName?: string }[];
      events?: { eventAction?: string; eventDate?: string }[];
      entities?: {
        roles?: string[];
        vcardArray?: [string, unknown[][]];
        entities?: { roles?: string[]; vcardArray?: [string, unknown[][]] }[];
      }[];
      links?: { href?: string; rel?: string }[];
      secureDNS?: { delegationSigned?: boolean };
    };
    const events = j.events ?? [];
    const created = events.find((e) => e.eventAction === "registration")?.eventDate;
    const expires = events.find((e) => e.eventAction === "expiration")?.eventDate;
    const updated = events.find((e) => e.eventAction === "last changed")?.eventDate;
    let registrar: string | undefined;
    let registrantCountry: string | undefined;
    let abuseEmail: string | undefined;
    const walk = (ents: NonNullable<typeof j.entities>) => {
      for (const ent of ents) {
        const roles = ent.roles ?? [];
        const vcard = ent.vcardArray?.[1] ?? [];
        if (roles.includes("registrar")) registrar = vcardValue(vcard, "fn") ?? registrar;
        if (roles.includes("registrant")) {
          const adr = vcard.find((row) => Array.isArray(row) && row[0] === "adr");
          if (Array.isArray(adr)) {
            const country = Array.isArray(adr[3]) ? adr[3][6] : undefined;
            if (typeof country === "string") registrantCountry = country;
          }
        }
        if (roles.includes("abuse") || roles.includes("notifications")) {
          abuseEmail = vcardValue(vcard, "email") ?? abuseEmail;
        }
        if (ent.entities) walk(ent.entities);
      }
    };
    walk(j.entities ?? []);
    return {
      handle: j.handle ?? j.ldhName,
      registrar,
      created,
      expires,
      updated,
      nameservers: (j.nameservers ?? []).map((n) => n.ldhName).filter((x): x is string => Boolean(x)),
      status: j.status ?? [],
      registrantCountry,
      rdapUrl: url,
      dnssec: j.secureDNS?.delegationSigned,
      abuseEmail,
    };
  } catch {
    return undefined;
  }
}

async function fetchSecurityTxt(domain: string): Promise<HostDossier["securityTxt"]> {
  const urls = [
    `https://${domain}/.well-known/security.txt`,
    `https://${domain}/security.txt`,
  ];
  for (const url of urls) {
    const res = await fetchFollow({ url, accept: "text/plain" });
    if (res.status === 200 && /contact:/i.test(res.body)) {
      return { found: true, url: res.finalUrl || url, excerpt: excerpt(res.body, "Contact", 400) };
    }
  }
  return { found: false };
}

async function fetchHttps(domain: string): Promise<HostDossier["https"]> {
  const url = `https://${domain}/`;
  const res = await fetchFollow({ url, accept: "text/html,application/xhtml+xml" });
  if (res.ssrf || res.status === 0) {
    return {
      ok: false,
      status: res.status,
      headers: res.headers,
      finalUrl: res.finalUrl,
    };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (["set-cookie", "cookie"].includes(k.toLowerCase())) continue;
    headers[k] = v;
  }
  return {
    ok: res.status > 0 && res.status < 400,
    status: res.status,
    title: htmlTitle(res.body),
    server: res.headers.server,
    hsts: res.headers["strict-transport-security"],
    csp: res.headers["content-security-policy"],
    xPoweredBy: res.headers["x-powered-by"],
    xFrameOptions: res.headers["x-frame-options"],
    xContentTypeOptions: res.headers["x-content-type-options"],
    referrerPolicy: res.headers["referrer-policy"],
    headers,
    finalUrl: res.finalUrl,
  };
}

async function fetchCert(domain: string): Promise<HostDossier["cert"]> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        servername: domain,
        timeout: 8000,
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || Object.keys(cert).length === 0) {
          resolve(undefined);
          return;
        }
        const san = String(cert.subjectaltname || "")
          .split(/,\s*/)
          .map((s) => s.replace(/^DNS:/i, "").trim())
          .filter(Boolean);
        const asOne = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        resolve({
          subject: asOne(cert.subject?.CN) || asOne(cert.subject?.O),
          issuer: asOne(cert.issuer?.O) || asOne(cert.issuer?.CN),
          san,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
        });
      },
    );
    socket.on("error", () => resolve(undefined));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}

export async function buildHostDossier(domain: string): Promise<HostDossier> {
  await assertSafeFetchTarget(`https://${domain}/`);
  const [a, aaaa, mxRaw, ns, txt, cname, dmarcTxt, soa, caa, rdap, securityTxt, https, cert] = await Promise.all([
    safeResolve(domain, "A"),
    safeResolve(domain, "AAAA"),
    dns.resolveMx(domain).catch(() => [] as { priority: number; exchange: string }[]),
    safeResolve(domain, "NS"),
    safeResolve(domain, "TXT"),
    safeResolve(domain, "CNAME"),
    safeResolve(`_dmarc.${domain}`, "TXT"),
    resolveSoa(domain),
    resolveCaa(domain),
    fetchRdap(domain),
    fetchSecurityTxt(domain),
    fetchHttps(domain),
    fetchCert(domain),
  ]);

  void resolvePublic;

  return {
    domain,
    rdap,
    dns: {
      a,
      aaaa,
      mx: mxRaw.sort((x, y) => x.priority - y.priority),
      ns,
      txt,
      cname,
      soa,
      caa,
    },
    spf: parseSpf(txt),
    dmarc: parseDmarc(dmarcTxt),
    securityTxt,
    https,
    cert,
  };
}

function hostRow(
  scanId: string,
  domain: string,
  site: string,
  category: string,
  status: LedgerRow["status"],
  reason: string,
  extras: Partial<LedgerRow> = {},
): LedgerRow {
  return {
    id: `${scanId}:host:${site}`,
    scanId,
    mode: "host",
    target: domain,
    site,
    category,
    status,
    reason,
    url: extras.url ?? `https://${domain}/`,
    method: extras.method ?? "GET",
    httpStatus: extras.httpStatus,
    finalUrl: extras.finalUrl,
    bodyExcerpt: extras.bodyExcerpt,
    latencyMs: extras.latencyMs,
    metadata: extras.metadata,
  };
}

export const HOST_LEDGER_COUNT = 12;

export async function runHostScan(
  scanId: string,
  domain: string,
  opts: { onRow: (row: LedgerRow) => void; onDossier: (d: HostDossier) => void },
): Promise<HostDossier | undefined> {
  try {
    await assertSafeFetchTarget(`https://${domain}/`);
  } catch (err) {
    const reason = err instanceof SsrfError || err instanceof Error ? err.message : String(err);
    opts.onRow(hostRow(scanId, domain, "SSRF preflight", "tls", "invalid", reason));
    return undefined;
  }

  let dossier: HostDossier;
  try {
    dossier = await buildHostDossier(domain);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    opts.onRow(hostRow(scanId, domain, "Host dossier", "dns", "error", reason));
    return undefined;
  }
  opts.onDossier(dossier);

  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DNS A",
      "dns",
      dossier.dns.a.length ? "found" : "miss",
      dossier.dns.a.length ? dossier.dns.a.join(", ") : "No A records",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DNS AAAA",
      "dns",
      dossier.dns.aaaa.length ? "found" : "miss",
      dossier.dns.aaaa.length ? dossier.dns.aaaa.join(", ") : "No AAAA records",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DNS MX",
      "dns",
      dossier.dns.mx.length ? "found" : "miss",
      dossier.dns.mx.length
        ? dossier.dns.mx.map((m) => `${m.priority} ${m.exchange}`).join(", ")
        : "No MX records",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DNS NS",
      "dns",
      dossier.dns.ns.length ? "found" : "miss",
      dossier.dns.ns.length ? dossier.dns.ns.join(", ") : "No NS records",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DNS SOA",
      "dns",
      dossier.dns.soa ? "found" : "miss",
      dossier.dns.soa ?? "No SOA record",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DNS CAA",
      "dns",
      dossier.dns.caa.length ? "found" : "miss",
      dossier.dns.caa.length ? dossier.dns.caa.join("; ") : "No CAA records",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "SPF",
      "dns",
      dossier.spf.length ? "found" : "miss",
      dossier.spf[0]?.raw ?? "No v=spf1 TXT",
      { url: domain, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "DMARC",
      "dns",
      dossier.dmarc.length ? "found" : "miss",
      dossier.dmarc[0]?.raw ?? `No TXT at _dmarc.${domain}`,
      { url: `_dmarc.${domain}`, method: "DNS" },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "RDAP",
      "rdap",
      dossier.rdap ? "found" : "miss",
      dossier.rdap
        ? [
            dossier.rdap.registrar,
            dossier.rdap.created && `created ${dossier.rdap.created}`,
            dossier.rdap.dnssec != null && `dnssec ${dossier.rdap.dnssec ? "signed" : "unsigned"}`,
            dossier.rdap.abuseEmail,
          ]
            .filter(Boolean)
            .join(" · ") || "RDAP record"
        : "No RDAP record",
      {
        url: dossier.rdap?.rdapUrl ?? `https://rdap.org/domain/${domain}`,
        method: "GET",
        metadata: dossier.rdap
          ? {
              displayName: dossier.rdap.registrar,
              extra: {
                expires: dossier.rdap.expires ?? "",
                dnssec: dossier.rdap.dnssec ?? false,
                abuse: dossier.rdap.abuseEmail ?? "",
              },
            }
          : undefined,
      },
    ),
  );
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "security.txt",
      "tls",
      dossier.securityTxt?.found ? "found" : "miss",
      dossier.securityTxt?.found
        ? dossier.securityTxt.excerpt ?? "Published"
        : "No security.txt",
      { url: `https://${domain}/.well-known/security.txt`, method: "GET" },
    ),
  );
  if (dossier.https) {
    const https = dossier.https;
    opts.onRow(
      hostRow(
        scanId,
        domain,
        "HTTPS",
        "tls",
        https.ok ? "found" : https.status && https.status >= 400 ? "escalate" : "error",
        https.title
          ? `title: ${https.title}`
          : `HTTP ${https.status ?? "?"} ${https.server ?? ""}`.trim(),
        {
          url: `https://${domain}/`,
          method: "GET",
          httpStatus: https.status,
          finalUrl: https.finalUrl,
          bodyExcerpt: https.title,
          metadata: {
            displayName: https.title,
            extra: {
              server: https.server ?? "",
              hsts: Boolean(https.hsts),
              csp: Boolean(https.csp),
              xfo: https.xFrameOptions ?? "",
              xcto: https.xContentTypeOptions ?? "",
            },
          },
        },
      ),
    );
  }
  opts.onRow(
    hostRow(
      scanId,
      domain,
      "TLS certificate",
      "tls",
      dossier.cert?.san.length || dossier.cert?.subject ? "found" : "miss",
      dossier.cert
        ? [dossier.cert.subject, dossier.cert.issuer && `issuer ${dossier.cert.issuer}`, dossier.cert.san.slice(0, 6).join(", ")]
            .filter(Boolean)
            .join(" · ")
        : "No certificate captured",
      {
        url: `https://${domain}/`,
        method: "TLS",
        metadata: dossier.cert
          ? {
              displayName: dossier.cert.subject,
              extra: {
                issuer: dossier.cert.issuer ?? "",
                san: dossier.cert.san.slice(0, 12).join(", "),
                validTo: dossier.cert.validTo ?? "",
              },
            }
          : undefined,
      },
    ),
  );
  return dossier;
}

export { parseSpf, parseDmarc };
