/** Shared env integer clamp (avoids import cycles between limits and variants). */
export function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw == null || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
