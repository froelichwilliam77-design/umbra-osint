import { HANDLE_MAX, HANDLE_MIN, HANDLE_REGEX, ROLE_LOCAL_PARTS } from "../shared/constants.ts";
import type { ScanProfile } from "../shared/scan-limits.ts";
import { envInt } from "./env-int.ts";
import { powerActive } from "./power.ts";

const HANDLE_OK = new RegExp(`^[A-Za-z0-9._-]{${HANDLE_MIN},${HANDLE_MAX}}$`);

function envFlag(name: string, fallback = true): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v == null || v === "") return fallback;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return ["1", "true", "yes", "on"].includes(v);
}

function add(out: string[], seen: Set<string>, seed: string, value: string | undefined) {
  if (!value) return;
  const v = value.replace(/^@/, "").toLowerCase();
  if (v === seed.toLowerCase()) return;
  if (v.length < HANDLE_MIN || v.length > HANDLE_MAX) return;
  if (!HANDLE_OK.test(v) || !HANDLE_REGEX.test(v)) return;
  if (seen.has(v)) return;
  seen.add(v);
  out.push(v);
}

/**
 * Useful mutations from one username seed. Separator swaps and digit strip
 * first; digit-add last (noisier). Never invents unrelated names.
 */
export function handleVariants(seed: string, cap = 6): string[] {
  const raw = seed.trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE_OK.test(raw)) return [];
  const seen = new Set<string>([raw]);
  const out: string[] = [];
  const push = (v?: string) => add(out, seen, raw, v);

  const swappedUnderscore = raw.replace(/\./g, "_").replace(/-/g, "_");
  const swappedDot = raw.replace(/_/g, ".").replace(/-/g, ".");
  const swappedHyphen = raw.replace(/[._]/g, "-");
  push(swappedUnderscore);
  push(swappedDot);
  push(swappedHyphen);
  push(raw.replace(/[._-]/g, ""));
  push(raw.replace(/[._-]+/g, "_"));
  push(raw.replace(/[._-]+/g, "."));
  push(raw.replace(/[._-]+/g, "-"));

  const noTrailDigits = raw.replace(/\d+$/, "");
  push(noTrailDigits);
  push(noTrailDigits.replace(/[._-]/g, ""));
  const noDigits = raw.replace(/\d+/g, "");
  push(noDigits);

  const parts = raw.split(/[._-]+/).filter(Boolean);
  if (parts.length === 2) {
    const [a, b] = parts;
    push(`${a}_${b}`);
    push(`${a}.${b}`);
    push(`${a}-${b}`);
    push(`${a}${b}`);
    push(`${b}${a}`);
    if (a[0] && b.length >= 2) push(`${a[0]}${b}`);
  }

  if (!/\d/.test(raw) && raw.length <= 20 && !ROLE_LOCAL_PARTS.has(raw)) {
    push(`${raw}1`);
    push(`${raw}01`);
    push(`${noTrailDigits || raw}123`);
  }

  return out.slice(0, Math.max(0, cap));
}

export function variantsEnabled(explicit?: boolean): boolean {
  if (explicit === false) return false;
  if (explicit === true) return true;
  return envFlag("UMBRA_VARIANTS", true);
}

/** How many extra handles to probe. Lean stays tiny; Full/Power can fan out. */
export function variantHandleCap(profile: ScanProfile, power?: boolean): number {
  const powered = power ?? powerActive(profile);
  const fallback = profile === "lean" ? 2 : powered ? 6 : 4;
  const max = profile === "lean" ? 4 : powered ? 10 : 6;
  return envInt("UMBRA_VARIANT_CAP", fallback, 0, max);
}

/** High-signal sites per variant (not the full map — keeps RSS sane). */
export function variantSiteCap(profile: ScanProfile, power?: boolean): number {
  const powered = power ?? powerActive(profile);
  const fallback = profile === "lean" ? 40 : powered ? 150 : 80;
  const max = profile === "lean" ? 80 : powered ? 220 : 120;
  return envInt("UMBRA_VARIANT_SITES", fallback, 0, max);
}

export function handleVariantProbeCount(
  profile: ScanProfile,
  opts?: { variants?: boolean; power?: boolean; extraHandles?: number },
): number {
  if (!variantsEnabled(opts?.variants)) return 0;
  const handles = opts?.extraHandles ?? variantHandleCap(profile, opts?.power);
  if (handles <= 0) return 0;
  return handles * variantSiteCap(profile, opts?.power);
}
