/** Client + server constants for 1 GB Railway boxes and phone UI. */

export const SSE_FLUSH_MS = 150;
export const LEDGER_ROW_HEIGHT = 64;
export const LEDGER_OVERSCAN = 16;
/** Lean handle map: curated + high-signal, still small enough for 1 GB. */
export const LEAN_SITE_CAP = 250;
export const FAST_TIER_SIZE = 150;
export const LEAN_CRAWL_PAGES = 25;
export const POWER_CRAWL_PAGES = 100;
export const WATCH_MIN_INTERVAL_MS = 60 * 60 * 1000;
export const WATCH_DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Cgroup/host RAM at or above this engages Power (TLS children + 8 workers). ~1.8 GB so a 2 GB plan qualifies. */
export const POWER_RAM_MB = 1800;
export const POWER_WORKERS = 8;
export const BATCH_MAX_LINES = 40;
export const SHARE_MAX_PER_CASE = 8;
export const SHARE_MAX_TOTAL = 64;

export type ScanProfile = "lean" | "full";

export function parseScanProfile(raw: unknown, fallback: ScanProfile = "full"): ScanProfile {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "lean" || v === "fast") return "lean";
  if (v === "full") return "full";
  return fallback;
}

export function inferDefaultProfile(env: Record<string, string | undefined> = process.env): ScanProfile {
  if (env.UMBRA_PROFILE?.trim()) return parseScanProfile(env.UMBRA_PROFILE, "lean");
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID) return "lean";
  return "full";
}

export function progressPercent(done: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

export function rssPressureOf(rssMb: number, softMb: number, hardMb: number): "ok" | "soft" | "hard" {
  if (rssMb >= hardMb) return "hard";
  if (rssMb >= softMb) return "soft";
  return "ok";
}

export function ledgerWindow(opts: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}): { start: number; end: number; offset: number; totalHeight: number; rendered: number } {
  const rowHeight = Math.max(1, opts.rowHeight);
  const count = Math.max(0, opts.count);
  const overscan = opts.overscan ?? LEDGER_OVERSCAN;
  const viewportHeight = Math.max(1, opts.viewportHeight);
  const visible = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const start = Math.max(0, Math.floor(Math.max(0, opts.scrollTop) / rowHeight) - overscan);
  const end = Math.min(count, start + visible + overscan * 2);
  return {
    start,
    end,
    offset: start * rowHeight,
    totalHeight: count * rowHeight,
    rendered: Math.max(0, end - start),
  };
}

export function createBatcher<T>(flush: (items: T[]) => void, flushMs = SSE_FLUSH_MS) {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;

  const drain = () => {
    timer = undefined;
    raf = 0;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    flush(batch);
  };

  const scheduleDrain = () => {
    if (typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(drain);
    } else {
      drain();
    }
  };

  return {
    push(item: T) {
      pending.push(item);
      if (timer == null) timer = setTimeout(scheduleDrain, flushMs);
    },
    pushMany(items: T[]) {
      if (!items.length) return;
      pending.push(...items);
      if (timer == null) timer = setTimeout(scheduleDrain, flushMs);
    },
    flush() {
      if (timer != null) clearTimeout(timer);
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      drain();
    },
    pendingCount() {
      return pending.length;
    },
  };
}
