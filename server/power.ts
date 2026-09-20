import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { POWER_RAM_MB, parseScanProfile, type ScanProfile } from "../shared/scan-limits.ts";

const LIMIT_FILES = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"];

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Cgroup memory.max (or limit) in MiB. Uncapped cgroups fall back to os.totalmem(). */
export function detectedRamMb(): number {
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

export function powerEnvEnabled(): boolean {
  if (envFlag("UMBRA_POWER")) return true;
  if (parseScanProfile(process.env.UMBRA_PROFILE, "lean") === "full" && process.env.UMBRA_PROFILE?.trim()) {
    return true;
  }
  return false;
}

/**
 * Power = TLS children + higher workers + larger crawl.
 * On when UMBRA_POWER=1, UMBRA_PROFILE=full, or this scan is Full on a ≥2 GB box.
 * Playwright stays off unless UMBRA_PLAYWRIGHT=1.
 */
export function powerActive(scanProfile?: ScanProfile): boolean {
  if (powerEnvEnabled()) return true;
  if (scanProfile === "full" && ramAllowsPower()) return true;
  return false;
}

export function powerPublic() {
  const ramMb = detectedRamMb();
  const envOn = powerEnvEnabled();
  const allowed = envOn || ramMb >= POWER_RAM_MB;
  return {
    enabled: powerActive(),
    env: envOn,
    allowed,
    ramMb,
    ramAllowsPower: ramMb >= POWER_RAM_MB,
    note: allowed
      ? "Power: more workers + curl-impersonate (UMBRA_CURL_MAX≥1). Playwright still off unless UMBRA_PLAYWRIGHT=1."
      : "Lean 1 GB defaults. Upgrade Railway memory to ≥2 GB and set UMBRA_POWER=1 (or Full in the UI) for TLS impersonation.",
  };
}
