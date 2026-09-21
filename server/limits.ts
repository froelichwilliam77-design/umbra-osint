/** Memory-safe production defaults for 1 GB hosts (Railway hobby / free). */

import {
  FAST_TIER_SIZE,
  LEAN_CRAWL_PAGES,
  LEAN_SITE_CAP,
  POWER_CRAWL_PAGES,
  POWER_WORKERS,
  inferDefaultProfile,
  parseScanProfile,
  type ScanProfile,
} from "../shared/scan-limits.ts";
import { powerActive, powerEnvEnabled, ramAllowsPower, scanPowerActive } from "./power.ts";

export type { ScanProfile };

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw == null || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Default global scan concurrency. 24 workers + curl-impersonate OOMs a 1 GB box. */
export const DEFAULT_WORKERS = 4;
export const MIN_WORKERS = 1;
export const MAX_WORKERS_CAP = 8;

export const DEFAULT_PER_HOST = 1;
export const MAX_PER_HOST_CAP = 2;

/** Concurrent curl-impersonate child processes. */
export const DEFAULT_CURL_MAX = 0;
export const MAX_CURL_CAP = 2;

/** Response body cap (bytes). Streamed; never buffer the full payload. */
export const DEFAULT_BODY_LIMIT = 48_000;
export const MAX_BODY_LIMIT = 96_000;

/** Playwright: off unless UMBRA_PLAYWRIGHT=1. One browser, killed after each GET. */
export const DEFAULT_PLAYWRIGHT_MAX = 1;
export const MAX_PLAYWRIGHT_CAP = 3;
export const PLAYWRIGHT_CONCURRENT = 1;

export const DEFAULT_MAX_SCANS = 1;

/** RSS watermarks (MiB). Railway hobby is 1024 MiB; abort before the cgroup OOM. */
export const DEFAULT_MEM_SOFT_MB = 450;
export const DEFAULT_MEM_HARD_MB = 600;

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function defaultWorkers(): number {
  if (envFlag("UMBRA_POWER")) {
    const raw = process.env.UMBRA_WORKERS;
    if (raw == null || raw.trim() === "" || Number(raw) <= DEFAULT_WORKERS) {
      return Math.min(maxWorkers(), POWER_WORKERS);
    }
  }
  const fallback = powerActive() ? Math.min(maxWorkers(), POWER_WORKERS) : DEFAULT_WORKERS;
  return envInt("UMBRA_WORKERS", fallback, MIN_WORKERS, maxWorkers());
}

export function maxWorkers(): number {
  return envInt("UMBRA_WORKERS_MAX", MAX_WORKERS_CAP, MIN_WORKERS, 32);
}

export function clampWorkers(n?: number): number {
  const cap = maxWorkers();
  const v = n == null || !Number.isFinite(n) ? defaultWorkers() : Math.trunc(n);
  return Math.min(cap, Math.max(MIN_WORKERS, v));
}

export function defaultPerHost(): number {
  return envInt("UMBRA_PER_HOST", DEFAULT_PER_HOST, 1, MAX_PER_HOST_CAP);
}

export function clampPerHost(n?: number): number {
  const v = n == null || !Number.isFinite(n) ? defaultPerHost() : Math.trunc(n);
  return Math.min(MAX_PER_HOST_CAP, Math.max(1, v));
}

export function impersonateMax(): number {
  const powered = powerEnvEnabled() || scanPowerActive() || ramAllowsPower();
  const raw = process.env.UMBRA_CURL_MAX;
  if (powered) {
    if (raw == null || raw.trim() === "" || raw.trim() === "0") return 1;
    return envInt("UMBRA_CURL_MAX", 1, 1, MAX_CURL_CAP);
  }
  return envInt("UMBRA_CURL_MAX", DEFAULT_CURL_MAX, 0, MAX_CURL_CAP);
}

export function bodyLimit(): number {
  return envInt("UMBRA_BODY_LIMIT", DEFAULT_BODY_LIMIT, 8_000, MAX_BODY_LIMIT);
}

export function playwrightRetryMax(): number {
  return envInt("UMBRA_PLAYWRIGHT_MAX", DEFAULT_PLAYWRIGHT_MAX, 0, MAX_PLAYWRIGHT_CAP);
}

export function playwrightConcurrent(): number {
  return PLAYWRIGHT_CONCURRENT;
}

export function maxConcurrentScans(): number {
  return envInt("UMBRA_MAX_SCANS", DEFAULT_MAX_SCANS, 1, 4);
}

/** No-progress auto-cancel (ms). Default 10 minutes. */
export const DEFAULT_SCAN_STALE_MS = 10 * 60 * 1000;

export function scanStaleMs(): number {
  return envInt("UMBRA_SCAN_STALE_MS", DEFAULT_SCAN_STALE_MS, 60_000, 60 * 60 * 1000);
}

export function memorySoftMb(): number {
  if (process.env.UMBRA_RSS_SOFT_MB?.trim()) return envInt("UMBRA_RSS_SOFT_MB", DEFAULT_MEM_SOFT_MB, 128, 8192);
  return envInt("UMBRA_MEM_SOFT_MB", DEFAULT_MEM_SOFT_MB, 128, 8192);
}

export function memoryHardMb(): number {
  if (process.env.UMBRA_RSS_HARD_MB?.trim()) return envInt("UMBRA_RSS_HARD_MB", DEFAULT_MEM_HARD_MB, 192, 8192);
  return envInt("UMBRA_MEM_HARD_MB", DEFAULT_MEM_HARD_MB, 192, 8192);
}

export function undiciConnections(): number {
  return envInt("UMBRA_HTTP_CONNECTIONS", 4, 2, 8);
}

export function defaultScanProfile(): ScanProfile {
  return inferDefaultProfile(process.env);
}

export function resolveScanProfile(raw?: unknown): ScanProfile {
  return parseScanProfile(raw, defaultScanProfile());
}

export function leanSiteCap(): number {
  return envInt("UMBRA_LEAN_SITES", LEAN_SITE_CAP, 50, 400);
}

export function fastTierSize(): number {
  return envInt("UMBRA_FAST_TIER", FAST_TIER_SIZE, 40, 300);
}

export function crawlPageCap(profile?: ScanProfile): number {
  const power = powerActive(profile);
  const fallback = power ? POWER_CRAWL_PAGES : LEAN_CRAWL_PAGES;
  const max = power ? 200 : 80;
  return envInt("UMBRA_CRAWL_PAGES", fallback, 5, max);
}

export function scanLimitsPublic(): {
  profile: ScanProfile;
  workers: number;
  workersMax: number;
  perHost: number;
  curlMax: number;
  bodyLimit: number;
  maxConcurrentScans: number;
  playwrightMax: number;
  playwrightConcurrent: number;
  scanStaleMs: number;
  leanSiteCap: number;
  fastTier: number;
  memSoftMb: number;
  memHardMb: number;
  crawlPages: number;
  power: boolean;
  powerEnv: boolean;
} {
  return {
    profile: defaultScanProfile(),
    workers: defaultWorkers(),
    workersMax: maxWorkers(),
    perHost: defaultPerHost(),
    curlMax: impersonateMax(),
    bodyLimit: bodyLimit(),
    maxConcurrentScans: maxConcurrentScans(),
    playwrightMax: playwrightRetryMax(),
    playwrightConcurrent: playwrightConcurrent(),
    scanStaleMs: scanStaleMs(),
    leanSiteCap: leanSiteCap(),
    fastTier: fastTierSize(),
    memSoftMb: memorySoftMb(),
    memHardMb: Math.max(memoryHardMb(), memorySoftMb() + 32),
    crawlPages: crawlPageCap(),
    power: powerActive(),
    powerEnv: powerEnvEnabled(),
  };
}
