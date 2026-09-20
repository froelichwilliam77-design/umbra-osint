import type { LedgerRow } from "../shared/types.ts";
import {
  classifyResponse,
  excerpt,
  handleAllowed,
  locationLooksLikeProfile,
  looksLikeApiUrl,
} from "./classify.ts";
import { HostPool, hostFromUrl } from "./concurrency.ts";
import { extractMetadata } from "./extract.ts";
import { fetchPublic, jitter } from "./http.ts";
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

  let res = await fetchPublic({
    url,
    method,
    headers,
    body,
    accept,
  });
  if (res.status === 429 || res.status === 503) {
    await jitter(400, 1100);
    res = await fetchPublic({
      url,
      method,
      headers,
      body,
      accept,
    });
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
  await Promise.all(
    sites.map((site) =>
      pool.schedule(hostFromUrl(site.uri_check), async () => {
        const protectedHost = Boolean(site.protection?.length);
        await jitter(protectedHost ? 120 : 70, protectedHost ? 420 : 260);
        const row = await probeSite(scanId, handle, site);
        opts.onRow(row);
      }),
    ),
  );
}
