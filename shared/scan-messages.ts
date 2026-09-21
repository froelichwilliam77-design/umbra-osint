/** User-facing scan / memory copy. Shared so API errors and the UI stay in sync. */

export const MEMORY_ABORT_MESSAGE =
  "Scan stopped to stay under the 1 GB memory limit. Keep Lean, or raise Railway Settings → Resources to ≥2 GB and use Power (TLS impersonation).";

export const MEMORY_BUSY_MESSAGE =
  "This host is near its memory limit. Wait a few seconds, stay on Lean, or raise Railway Settings → Resources to ≥2 GB.";

export const SCAN_REPLACE_BUSY =
  "A scan is already running. 1 GB hosts keep one scan in flight — tap Cancel, then Recon.";

export const POWER_1GB_CONFIRM =
  "Power enables TLS impersonation (curl children) and 8 workers. On a 1 GB Railway plan this can OOM the cgroup. Raise memory to ≥2 GB first: Railway service → Settings → Resources. Continue anyway?";

export const POWER_BANNER_1GB =
  "This host is under 2 GB RAM. Lean stays safe. For Power (TLS + more workers), open Railway → Settings → Resources and raise memory to ≥2 GB, then tap Power.";

export function explainScanStartError(status: number, raw?: string): string {
  const msg = (raw ?? "").trim();
  if (status === 503 || /memory/i.test(msg)) return MEMORY_BUSY_MESSAGE;
  if (status === 409 || status === 429) return msg && !/^scan failed$/i.test(msg) ? msg : SCAN_REPLACE_BUSY;
  if (status === 400 && msg) return msg;
  if (msg && !/^scan failed$/i.test(msg)) return msg;
  if (status > 0) return `Scan could not start (HTTP ${status}). Check the query and try Lean.`;
  return "Scan could not start. Check the network connection and try again.";
}

export function explainScanAbort(reason?: string): string {
  const r = (reason ?? "").trim();
  if (!r) return "Scan cancelled.";
  if (/memory/i.test(r)) return MEMORY_ABORT_MESSAGE;
  if (/stale timeout/i.test(r)) return `Scan stalled (${r}). Tap Recon to start a fresh scan.`;
  if (/replaced/i.test(r)) return "Previous scan was replaced by a new one.";
  if (/cancelled by user/i.test(r)) return "Scan cancelled.";
  return r;
}

export function isTransientHttpStatus(status: number, error?: string): boolean {
  if (status === 502 || status === 503 || status === 504 || status === 408) return true;
  if (status === 0 && error) {
    return /timeout|econnreset|und_err|network|fetch failed|socket|aborted/i.test(error);
  }
  return false;
}
