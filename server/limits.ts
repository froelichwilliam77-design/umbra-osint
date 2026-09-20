/** Memory-safe production defaults for 1 GB hosts (Railway hobby / free). */

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw == null || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Default global scan concurrency. 24 workers + curl-impersonate OOMs a 1 GB box. */
export const DEFAULT_WORKERS = 8;
export const MIN_WORKERS = 2;
export const MAX_WORKERS_CAP = 16;

export const DEFAULT_PER_HOST = 1;
export const MAX_PER_HOST_CAP = 2;

/** Concurrent curl-impersonate child processes. */
export const DEFAULT_CURL_MAX = 3;
export const MAX_CURL_CAP = 6;

/** Response body cap (bytes). Streamed; never buffer the full payload. */
export const DEFAULT_BODY_LIMIT = 96_000;
export const MAX_BODY_LIMIT = 256_000;

/** Playwright: off unless UMBRA_PLAYWRIGHT=1. One browser, killed after each GET. */
export const DEFAULT_PLAYWRIGHT_MAX = 1;
export const MAX_PLAYWRIGHT_CAP = 3;
export const PLAYWRIGHT_CONCURRENT = 1;

export const DEFAULT_MAX_SCANS = 1;

/** RSS watermarks (MiB). Railway hobby is 1024 MiB; abort before the cgroup OOM. */
export const DEFAULT_MEM_SOFT_MB = 640;
export const DEFAULT_MEM_HARD_MB = 800;

export function defaultWorkers(): number {
  return envInt("UMBRA_WORKERS", DEFAULT_WORKERS, MIN_WORKERS, MAX_WORKERS_CAP);
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
  return envInt("UMBRA_CURL_MAX", DEFAULT_CURL_MAX, 1, MAX_CURL_CAP);
}

export function bodyLimit(): number {
  return envInt("UMBRA_BODY_LIMIT", DEFAULT_BODY_LIMIT, 16_000, MAX_BODY_LIMIT);
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
  return envInt("UMBRA_MEM_SOFT_MB", DEFAULT_MEM_SOFT_MB, 128, 8192);
}

export function memoryHardMb(): number {
  return envInt("UMBRA_MEM_HARD_MB", DEFAULT_MEM_HARD_MB, 192, 8192);
}

export function undiciConnections(): number {
  return envInt("UMBRA_HTTP_CONNECTIONS", 16, 4, 48);
}

export function scanLimitsPublic(): {
  workers: number;
  workersMax: number;
  perHost: number;
  curlMax: number;
  bodyLimit: number;
  maxConcurrentScans: number;
  playwrightMax: number;
  playwrightConcurrent: number;
  scanStaleMs: number;
} {
  return {
    workers: defaultWorkers(),
    workersMax: maxWorkers(),
    perHost: defaultPerHost(),
    curlMax: impersonateMax(),
    bodyLimit: bodyLimit(),
    maxConcurrentScans: maxConcurrentScans(),
    playwrightMax: playwrightRetryMax(),
    playwrightConcurrent: playwrightConcurrent(),
    scanStaleMs: scanStaleMs(),
  };
}
