import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { POWER_RAM_MB, type ScanProfile } from "../shared/scan-limits.ts";

const LIMIT_FILES = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"];

let ramOverrideMb: number | null = null;
let scanPowerDepth = 0;

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function setDetectedRamMbForTests(mb: number | null): void {
  ramOverrideMb = mb;
}

export function beginScanPower(): void {
  scanPowerDepth += 1;
}

export function endScanPower(): void {
  scanPowerDepth = Math.max(0, scanPowerDepth - 1);
}

export function resetScanPowerForTests(): void {
  scanPowerDepth = 0;
}

export function scanPowerActive(): boolean {
  return scanPowerDepth > 0;
}

/** Cgroup memory.max (or limit) in MiB. Uncapped cgroups fall back to os.totalmem(). */
export function detectedRamMb(): number {
  if (ramOverrideMb != null && Number.isFinite(ramOverrideMb)) return ramOverrideMb;
  for (const p of LIMIT_FILES) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8").trim();
      if (!raw || raw === "max") continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n < 1e16) {
        const mb = Math.round(n / (1024 * 1024));
        if (mb >= 64 && mb < 1024 * 1024) return mb;
      }
    } catch {
      /* next */
    }
  }
  return Math.round(os.totalmem() / (1024 * 1024));
}

export function ramAllowsPower(): boolean {
  return detectedRamMb() >= POWER_RAM_MB;
}

/** Operator opted in via env. UMBRA_PROFILE=full alone does not enable TLS on 1 GB. */
export function powerEnvEnabled(): boolean {
  return envFlag("UMBRA_POWER");
}

/**
 * Power = TLS children + higher workers + larger crawl.
 * On when UMBRA_POWER=1, RAM ≥ ~1800 MB, or a scan requested Power in the UI.
 * Playwright stays off unless UMBRA_PLAYWRIGHT=1.
 */
export function powerActive(scanProfile?: ScanProfile): boolean {
  if (powerEnvEnabled()) return true;
  if (scanPowerActive()) return true;
  if (ramAllowsPower()) return true;
  void scanProfile;
  return false;
}

export function powerPublic() {
  const ramMb = detectedRamMb();
  const envOn = powerEnvEnabled();
  const ramOn = ramMb >= POWER_RAM_MB;
  const allowed = envOn || ramOn;
  const enabled = powerActive();
  return {
    enabled,
    env: envOn,
    allowed,
    ramMb,
    ramAllowsPower: ramOn,
    ramThresholdMb: POWER_RAM_MB,
    note: enabled
      ? "Power: more workers + curl-impersonate (UMBRA_CURL_MAX≥1). Playwright still off unless UMBRA_PLAYWRIGHT=1."
      : "Lean 1 GB defaults. Upgrade Railway memory to ≥2 GB (cgroup ~1800 MB+) and set UMBRA_POWER=1, or tap Power in the UI (warns on 1 GB).",
  };
}
