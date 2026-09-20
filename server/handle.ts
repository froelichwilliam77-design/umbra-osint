import type { LedgerRow } from "../shared/types.ts";
import {
  classifyResponse,
  excerpt,
  handleAllowed,
  locationLooksLikeProfile,
  looksLikeApiUrl,
} from "./classify.ts";
import { HostPool, hostFromUrl } from "./concurrency.ts";
import { fetchImpersonate, impersonateAvailable, shouldImpersonate } from "./curl-impersonate.ts";
import { extractMetadata } from "./extract.ts";
import { fetchPublic, jitter, retryAfterMs, type HttpRequest, type HttpResponse } from "./http.ts";
import {
  fetchPlaywright,
  playwrightEnabled,
  playwrightMax,
  shouldEscalateBrowser,
} from "./playwright-pool.ts";
import { categoryOf, loadSchema, sitesForScan, type WmnSite } from "./schema.ts";

const SAFE_HANDLE = /^[A-Za-z0-9._-]+$/;

function applyAccount(template: string, handle: string, strip?: string): string {
  let value = handle;
  if (strip) value = value.split("").filter((c) => !strip.includes(c)).join("");
  const encoded = SAFE_HANDLE.test(value) ? value : encodeURIComponent(value);
  return template.replaceAll("{account}", encoded).replaceAll("%7Baccount%7D", encoded);
}

function applyRaw(template: string, handle: string, strip?: string): string {
  let value = handle;
  if (strip) value = value.split("").filter((c) => !strip.includes(c)).join("");
  return template.replaceAll("{account}", value);
}

export function materialize(site: WmnSite, handle: string): {
  url: string;
  pretty?: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
} {
  const url = applyAccount(site.uri_check, handle, site.strip_bad_char);
  const pretty = site.uri_pretty
    ? applyAccount(site.uri_pretty, handle, site.strip_bad_char)
    : undefined;
  const headers = site.headers
    ? Object.fromEntries(
        Object.entries(site.headers).map(([k, v]) => [k, applyRaw(v, handle, site.strip_bad_char)]),
      )
    : undefined;
  const body = site.post_body ? applyRaw(site.post_body, handle, site.strip_bad_char) : undefined;
  return {
    url,
    pretty,
    method: body ? "POST" : "GET",
    headers,
    body,
  };
}

async function fetchProbe(req: HttpRequest, protection?: string[]): Promise<HttpResponse> {
  const impersonateFirst = shouldImpersonate({ protection, url: req.url });
  if (impersonateFirst) {
    const r = await fetchImpersonate(req);
    if (r.status > 0) return r;
  }
  let res = await fetchPublic(req);
  if (res.status === 429 || res.status === 503) {
    const wait = retryAfterMs(res.headers, res.status === 429 ? 800 : 500);
    await jitter(wait, wait + 400);
    res = await fetchPublic(req);
  }
  if (
    impersonateAvailable() &&
    !impersonateFirst &&
    (res.status === 403 || res.status === 429 || /cloudflare|captcha|just a moment|challenge/i.test(res.body.slice(0, 4000)))
  ) {
    const r = await fetchImpersonate(req);
    if (r.status > 0) return r;
  }
  return res;
}

function rowBase(scanId: string, handle: string, site: WmnSite, url: string, pretty: string | undefined, method: string): Omit<LedgerRow, "status" | "reason"> {
  return {
    id: `${scanId}:${site.name}`,
    scanId,
    mode: "handle",
    target: handle,
    site: site.name,
    category: categoryOf(site),
    url,
    profileUrl: pretty,
    method,
    protection: site.protection,
  };
}

export async function probeSite(
  scanId: string,
  handle: string,
  site: WmnSite,
): Promise<LedgerRow> {
  const allowed = handleAllowed(handle, site.username_regex);
  const { url, pretty, method, headers, body } = materialize(site, handle);
  if (!allowed.ok) {
    return {
      ...rowBase(scanId, handle, site, url, pretty, method),
      status: "invalid",
      reason: allowed.reason ?? "Handle skipped for this site.",
    };
  }

  const accept =
    headers?.Accept ??
    (body || looksLikeApiUrl(url) ? "application/json, text/plain, */*" : undefined);

  let res = await fetchProbe(
    {
      url,
      method,
      headers,
      body,
      accept,
    },
    site.protection,
  );
  if (res.status === 429 || res.status === 503) {
    await jitter(400, 1100);
    res = await fetchProbe(
      {
        url,
        method,
        headers,
        body,
        accept,
      },
      site.protection,
    );
  }
  // Follow one same-host profile redirect so dual-condition + metadata see the real page.
  if (
    method === "GET" &&
    res.status >= 300 &&
    res.status < 400 &&
    res.location &&
    locationLooksLikeProfile(url, res.location, handle)
  ) {
    const followed = await fetchPublic({
      url: res.finalUrl || res.location,
      method: "GET",
      headers,
      accept,
    });
    if (!followed.ssrf && followed.status > 0) {
      res = {
        ...followed,
        location: res.location,
        url,
      };
    }
  }

  if (res.ssrf) {
    return {
      ...rowBase(scanId, handle, site, url, pretty, method),
      status: "invalid",
      reason: res.error ?? "SSRF blocked",
      httpStatus: res.status,
      latencyMs: res.latencyMs,
    };
  }

  if (res.error && res.status === 0) {
    return {
      ...rowBase(scanId, handle, site, url, pretty, method),
      status: "error",
      reason: res.error,
      latencyMs: res.latencyMs,
    };
  }

  const verdict = classifyResponse(
    {
      e_code: site.e_code,
      e_string: site.e_string,
      m_code: site.m_code,
      m_string: site.m_string,
    },
    {
      status: res.status,
      body: res.body,
      headers: res.headers,
      requestedUrl: url,
      finalUrl: res.finalUrl,
      location: res.location,
      account: handle,
    },
  );

  const metadata =
    verdict.status === "found"
      ? extractMetadata(site.name, res.body, loadSchema().extractors)
      : undefined;

  return {
    ...rowBase(scanId, handle, site, url, pretty, method),
    status: verdict.status,
    reason: verdict.reason,
    profileUrl: pretty ?? (verdict.status === "found" ? res.finalUrl : undefined),
    httpStatus: res.status,
    finalUrl: res.finalUrl,
    redirectChain: res.location && res.finalUrl !== url ? [url, res.finalUrl] : undefined,
    bodyExcerpt: excerpt(res.body, verdict.existHit ? site.e_string : site.m_string),
    latencyMs: res.latencyMs,
    metadata,
    via: res.via,
  };
}

export async function runHandleScan(
  scanId: string,
  handle: string,
  opts: {
    includeNsfw: boolean;
    workers: number;
    perHost: number;
    onRow: (row: LedgerRow) => void;
  },
): Promise<void> {
  const sites = sitesForScan(opts.includeNsfw);
  const pool = new HostPool({ global: opts.workers, perHost: opts.perHost });
  let playwrightLeft = playwrightEnabled() ? playwrightMax() : 0;
  await Promise.all(
    sites.map((site) =>
      pool.schedule(hostFromUrl(site.uri_check), async () => {
        const protectedHost = Boolean(site.protection?.length);
        await jitter(protectedHost ? 160 : 80, protectedHost ? 520 : 280);
        let row = await probeSite(scanId, handle, site);
        if (
          playwrightLeft > 0 &&
          shouldEscalateBrowser(row.status, row.reason, row.method)
        ) {
          playwrightLeft -= 1;
          const { url, pretty, method, headers } = materialize(site, handle);
          const pw = await fetchPlaywright({
            url,
            method: "GET",
            headers,
            timeoutMs: 18_000,
          });
          if (pw.status > 0 && !pw.ssrf) {
            const verdict = classifyResponse(
              {
                e_code: site.e_code,
                e_string: site.e_string,
                m_code: site.m_code,
                m_string: site.m_string,
              },
              {
                status: pw.status,
                body: pw.body,
                headers: pw.headers,
                requestedUrl: url,
                finalUrl: pw.finalUrl,
                account: handle,
              },
            );
            row = {
              ...row,
              status: verdict.status,
              reason: `${verdict.reason} (Playwright GET escalation)`,
              httpStatus: pw.status,
              finalUrl: pw.finalUrl,
              bodyExcerpt: excerpt(pw.body, verdict.existHit ? site.e_string : site.m_string),
              latencyMs: (row.latencyMs ?? 0) + pw.latencyMs,
              via: "playwright",
              profileUrl: pretty ?? (verdict.status === "found" ? pw.finalUrl : row.profileUrl),
              metadata:
                verdict.status === "found"
                  ? extractMetadata(site.name, pw.body, loadSchema().extractors)
                  : row.metadata,
            };
          }
        }
        opts.onRow(row);
      }),
    ),
  );
}
