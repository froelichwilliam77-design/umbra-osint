import dns from "node:dns/promises";
import { ROLE_LOCAL_PARTS } from "../shared/constants.ts";
import type { LedgerRow, MailDossier } from "../shared/types.ts";
import { analyzeLocalPart } from "./detect.ts";
import type { OracleVerdict } from "./oracles.ts";
import { HostPool, hostFromUrl } from "./concurrency.ts";
import { parseDmarc, parseSpf, lookupBimi, lookupDkim, lookupRdap } from "./host.ts";
import { fetchPublic, jitter } from "./http.ts";
import { finalizeOracleVerdict } from "./mail-oracle-recover.ts";
import { handlers } from "./mail-oracles.ts";
import { gravatarProfile, mailOpenLinks, mailPivots } from "./mail-util.ts";
import { loadSchema, type OracleSpec } from "./schema.ts";

export { mailPivots, mailOpenLinks, sha256Email } from "./mail-util.ts";

function guessProvider(domain: string, mx: { exchange: string }[]): string | undefined {
  const exch = mx.map((m) => m.exchange.toLowerCase()).join(" ");
  if (domain.endsWith("gmail.com") || exch.includes("google.com") || exch.includes("googlemail")) {
    return domain === "gmail.com" ? "Gmail" : "Google Workspace";
  }
  if (exch.includes("outlook.com") || exch.includes("protection.outlook.com") || domain.endsWith("hotmail.com") || domain.endsWith("live.com") || domain.endsWith("outlook.com")) {
    return domain.endsWith("outlook.com") || domain.endsWith("hotmail.com") || domain.endsWith("live.com")
      ? "Microsoft consumer"
      : "Microsoft 365";
  }
  if (exch.includes("protonmail") || domain.endsWith("proton.me") || domain.endsWith("protonmail.com")) {
    return "Proton";
  }
  if (exch.includes("icloud.com") || domain.endsWith("icloud.com") || domain.endsWith("me.com")) return "iCloud";
  if (exch.includes("yahoodns") || domain.endsWith("yahoo.com")) return "Yahoo";
  if (exch.includes("fastmail")) return "Fastmail";
  if (mx.length) return "Custom / other";
  return undefined;
}

export async function resolveMx(domain: string): Promise<{ priority: number; exchange: string }[]> {
  try {
    const recs = await dns.resolveMx(domain);
    return recs.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

export async function hasMailExchanger(domain: string): Promise<boolean> {
  const mx = await resolveMx(domain);
  if (mx.length) return true;
  try {
    const a = await dns.resolve4(domain);
    if (a.length) return true;
  } catch {
    /* continue */
  }
  try {
    const aaaa = await dns.resolve6(domain);
    if (aaaa.length) return true;
  } catch {
    /* continue */
  }
  return false;
}

async function lookupM365Tenant(email: string): Promise<MailDossier["tenant"]> {
  const url = `https://login.microsoftonline.com/GetUserRealm.srf?login=${encodeURIComponent(email)}&json=1`;
  const res = await fetchPublic({ url, accept: "application/json" });
  if (res.status !== 200) return undefined;
  try {
    const j = JSON.parse(res.body) as {
      NameSpaceType?: string;
      FederationBrandName?: string;
      CloudInstanceName?: string;
      DomainName?: string;
    };
    if (!j.NameSpaceType && !j.DomainName) return undefined;
    return {
      namespace: j.NameSpaceType,
      federationBrand: j.FederationBrandName,
      cloud: j.CloudInstanceName,
      domainName: j.DomainName,
    };
  } catch {
    return undefined;
  }
}

async function domainAuthRecords(domain: string): Promise<{
  spf: MailDossier["domainSpf"];
  dmarc: MailDossier["domainDmarc"];
  dkim: MailDossier["dkim"];
  bimi: MailDossier["bimi"];
  domainCreated?: string;
}> {
  let txt: string[] = [];
  let dmarcTxt: string[] = [];
  try {
    txt = (await dns.resolveTxt(domain)).map((p) => p.join(""));
  } catch {
    txt = [];
  }
  try {
    dmarcTxt = (await dns.resolveTxt(`_dmarc.${domain}`)).map((p) => p.join(""));
  } catch {
    dmarcTxt = [];
  }
  const [dkim, bimi, rdap] = await Promise.all([lookupDkim(domain), lookupBimi(domain), lookupRdap(domain)]);
  return {
    spf: parseSpf(txt),
    dmarc: parseDmarc(dmarcTxt),
    dkim,
    bimi,
    domainCreated: rdap?.created,
  };
}

export async function buildMailDossier(email: string): Promise<MailDossier> {
  const normalized = email.trim().toLowerCase();
  const [localPart, domain] = normalized.split("@");
  const [mx, gravatar, tenant, auth] = await Promise.all([
    resolveMx(domain),
    gravatarProfile(normalized),
    lookupM365Tenant(normalized),
    domainAuthRecords(domain),
  ]);
  const disposable = loadSchema().disposable.has(domain);
  const localPartAnalysis = analyzeLocalPart(localPart);
  const pivots = mailPivots(normalized);
  for (const acc of gravatar.accounts ?? []) {
    if (acc.shortname && /^[A-Za-z0-9._-]{2,39}$/.test(acc.shortname)) pivots.push(acc.shortname);
  }
  return {
    email: normalized,
    localPart,
    domain,
    disposable,
    roleBased: ROLE_LOCAL_PARTS.has(localPart.split("+")[0]),
    plusAddress: localPart.includes("+"),
    providerGuess: guessProvider(domain, mx),
    mx,
    hasMx: mx.length > 0,
    gravatar: {
      exists: gravatar.exists,
      hash: gravatar.hash,
      sha256: gravatar.sha256,
      profileUrl: gravatar.profileUrl,
      displayName: gravatar.displayName,
      avatarUrl: gravatar.avatarUrl,
      accounts: gravatar.accounts,
    },
    tenant,
    domainSpf: auth.spf,
    domainDmarc: auth.dmarc,
    dkim: auth.dkim,
    bimi: auth.bimi,
    domainCreated: auth.domainCreated,
    pivots: [...new Set(pivots)],
    localPartAnalysis,
    openLinks: mailOpenLinks(normalized, gravatar.hash, gravatar.sha256),
  };
}

function rowFromVerdict(
  scanId: string,
  email: string,
  spec: OracleSpec,
  verdict: OracleVerdict,
  extras: Partial<LedgerRow>,
): LedgerRow {
  return {
    id: `${scanId}:oracle:${spec.id}`,
    scanId,
    mode: "mail",
    target: email,
    site: spec.name,
    category: spec.category,
    status: verdict.status,
    reason: verdict.reason,
    url: extras.url ?? "",
    method: extras.method ?? "GET",
    httpStatus: extras.httpStatus,
    finalUrl: extras.finalUrl,
    bodyExcerpt: extras.bodyExcerpt,
    latencyMs: extras.latencyMs,
    metadata: extras.metadata,
    protection: extras.protection,
  };
}

export async function runMailScan(
  scanId: string,
  email: string,
  opts: {
    workers: number;
    perHost: number;
    onRow: (row: LedgerRow) => void;
    pool?: HostPool;
    onPool?: (pool: HostPool) => void;
  },
): Promise<void> {
  const oracles = loadSchema().oracles.filter((spec) => {
    if (spec.handler === "hibp" && !process.env.HIBP_API_KEY?.trim()) return false;
    return true;
  });
  const pool = opts.pool ?? new HostPool({ global: opts.workers, perHost: opts.perHost });
  opts.onPool?.(pool);
  await Promise.all(
    oracles.map((spec) =>
      pool.schedule(spec.id, async () => {
        await jitter(60, 240);
        if (pool.isAborted) return;
        if (spec.quarantine) {
          const reason =
            typeof spec.quarantine === "string"
              ? spec.quarantine.startsWith("Quarantined")
                ? spec.quarantine
                : `Quarantined: ${spec.quarantine}`
              : "Quarantined: chronically CSRF/dead endpoint — not probed (would not yield found/miss).";
          opts.onRow(
            rowFromVerdict(scanId, email, spec, { status: "blocked", reason }, {
              url: "",
              method: "SKIP",
            }),
          );
          return;
        }
        try {
          const fn = handlers[spec.handler];
          if (!fn) {
            opts.onRow(
              rowFromVerdict(
                scanId,
                email,
                spec,
                { status: "error", reason: `No handler implemented for ${spec.handler}.` },
                { url: "", method: "GET" },
              ),
            );
            return;
          }
          const { verdict, extras } = await fn(email);
          const recovered = finalizeOracleVerdict(
            {
              ok: Boolean(extras.httpStatus && extras.httpStatus >= 200 && extras.httpStatus < 300),
              status: extras.httpStatus ?? 0,
              url: extras.url ?? "",
              finalUrl: extras.finalUrl ?? extras.url ?? "",
              headers: {},
              body: extras.bodyExcerpt ?? "",
              latencyMs: extras.latencyMs ?? 0,
              via: extras.via,
            },
            verdict,
          );
          opts.onRow(rowFromVerdict(scanId, email, spec, recovered, extras));
        } catch (err) {
          opts.onRow(
            rowFromVerdict(
              scanId,
              email,
              spec,
              { status: "error", reason: err instanceof Error ? err.message : String(err) },
              { url: "", method: "GET" },
            ),
          );
        }
      }),
    ),
  );
  pool.throwIfAborted();
  void hostFromUrl;
}
