import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  WATCH_DEFAULT_INTERVAL_MS,
  WATCH_MIN_INTERVAL_MS,
} from "../shared/scan-limits.ts";
import type { DetectedKind, FoundSnapshot, LedgerRow, WatchAlert, WatchRecord } from "../shared/types.ts";
import { casesDir } from "./cases.ts";
import { canStartScan, startScan, waitForScan } from "./scans.ts";
import { resolveMode } from "./detect.ts";

const MAX_WATCHES = 32;
const MAX_ALERTS = 80;
const memoryWatches = new Map<string, WatchRecord>();
const memoryAlerts: WatchAlert[] = [];

function canWrite(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, ".umbra-write");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function watchesDir(): string | null {
  const env = process.env.UMBRA_WATCHES_DIR?.trim();
  if (env) return canWrite(env) ? env : null;
  const cases = casesDir();
  if (cases) {
    const nested = join(cases, "_watches");
    return canWrite(nested) ? nested : null;
  }
  if (existsSync("/data") && canWrite("/data/watches")) return "/data/watches";
  return null;
}

export function alertsDir(): string | null {
  const w = watchesDir();
  if (!w) return null;
  const nested = join(w, "_alerts");
  return canWrite(nested) ? nested : null;
}

function fileFor(dir: string, id: string): string {
  return join(dir, `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function watchMinIntervalMs(): number {
  const raw = process.env.UMBRA_WATCH_MIN_MS;
  const n = raw == null || raw.trim() === "" ? WATCH_MIN_INTERVAL_MS : Number(raw);
  if (!Number.isFinite(n)) return WATCH_MIN_INTERVAL_MS;
  return Math.max(50, Math.trunc(n));
}

export function clampWatchIntervalMs(raw?: number): number {
  const min = watchMinIntervalMs();
  const v = raw == null || !Number.isFinite(raw) ? WATCH_DEFAULT_INTERVAL_MS : Math.trunc(raw);
  return Math.max(min, v);
}

function persistWatch(rec: WatchRecord): WatchRecord {
  rec.updatedAt = new Date().toISOString();
  memoryWatches.set(rec.id, rec);
  const dir = watchesDir();
  if (dir) {
    try {
      writeFileSync(fileFor(dir, rec.id), JSON.stringify(rec));
    } catch {
      /* optional */
    }
  }
  return rec;
}

function persistAlert(alert: WatchAlert): WatchAlert {
  memoryAlerts.unshift(alert);
  while (memoryAlerts.length > MAX_ALERTS) memoryAlerts.pop();
  const dir = alertsDir();
  if (dir) {
    try {
      writeFileSync(fileFor(dir, alert.id), JSON.stringify(alert));
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse();
      for (const extra of files.slice(MAX_ALERTS)) {
        try {
          unlinkSync(join(dir, extra));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* optional */
    }
  }
  return alert;
}

function loadDisk(): void {
  const dir = watchesDir();
  if (dir) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        const rec = readJson<WatchRecord>(join(dir, f));
        if (rec?.id) memoryWatches.set(rec.id, rec);
      }
    } catch {
      /* ignore */
    }
  }
  const adir = alertsDir();
  if (adir && memoryAlerts.length === 0) {
    try {
      const loaded: WatchAlert[] = [];
      for (const f of readdirSync(adir)) {
        if (!f.endsWith(".json")) continue;
        const rec = readJson<WatchAlert>(join(adir, f));
        if (rec?.id) loaded.push(rec);
      }
      loaded.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      memoryAlerts.splice(0, memoryAlerts.length, ...loaded.slice(0, MAX_ALERTS));
    } catch {
      /* ignore */
    }
  }
}

export function listWatches(): WatchRecord[] {
  loadDisk();
  return [...memoryWatches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getWatch(id: string): WatchRecord | null {
  loadDisk();
  return memoryWatches.get(id) ?? null;
}

export function listAlerts(): WatchAlert[] {
  loadDisk();
  return [...memoryAlerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createWatch(input: {
  query: string;
  mode?: DetectedKind | "auto";
  intervalMs?: number;
  intervalHours?: number;
}): WatchRecord {
  const query = input.query.trim();
  if (!query) throw new Error("query is required");
  const mode = resolveMode(query, input.mode === "auto" || !input.mode ? "auto" : input.mode);
  if (mode === "crawl") throw new Error("Watches cover handle, mail, host, and phone — not crawl jobs.");
  const intervalMs = clampWatchIntervalMs(
    input.intervalMs ?? (input.intervalHours != null ? input.intervalHours * 60 * 60 * 1000 : undefined),
  );
  const now = new Date().toISOString();
  if (memoryWatches.size === 0) loadDisk();
  if (memoryWatches.size >= MAX_WATCHES) throw new Error(`At most ${MAX_WATCHES} watches`);
  const rec: WatchRecord = {
    id: randomUUID(),
    query,
    mode,
    intervalMs,
    createdAt: now,
    updatedAt: now,
    nextRunAt: now,
    lastFound: [],
    enabled: true,
  };
  return persistWatch(rec);
}

export function deleteWatch(id: string): boolean {
  loadDisk();
  const had = memoryWatches.delete(id);
  const dir = watchesDir();
  if (dir) {
    try {
      unlinkSync(fileFor(dir, id));
    } catch {
      return had;
    }
  }
  return had;
}

export function markAlertRead(id: string, read = true): WatchAlert | null {
  loadDisk();
  const alert = memoryAlerts.find((a) => a.id === id);
  if (!alert) return null;
  alert.read = read;
  persistAlert(alert);
  return alert;
}

export function foundSnapshot(rows: LedgerRow[]): FoundSnapshot[] {
  return rows
    .filter((r) => r.status === "found")
    .map((r) => ({ site: r.site, url: r.profileUrl || r.url, status: r.status }));
}

export function diffFounds(prev: FoundSnapshot[], next: FoundSnapshot[]): {
  newFounds: FoundSnapshot[];
  goneFounds: FoundSnapshot[];
} {
  const key = (s: FoundSnapshot) => `${s.site.toLowerCase()}|${s.url.toLowerCase()}`;
  const a = new Map(prev.map((s) => [key(s), s]));
  const b = new Map(next.map((s) => [key(s), s]));
  return {
    newFounds: [...b.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v),
    goneFounds: [...a.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v),
  };
}

export function alertWebhookUrl(): string | null {
  const u = process.env.UMBRA_ALERT_WEBHOOK?.trim();
  return u || null;
}

async function postWebhook(alert: WatchAlert): Promise<boolean> {
  const url = alertWebhookUrl();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "umbra-watch/1.7" },
      body: JSON.stringify({
        type: "umbra.alert",
        watchId: alert.watchId,
        query: alert.query,
        mode: alert.mode,
        createdAt: alert.createdAt,
        newFounds: alert.newFounds,
        goneFounds: alert.goneFounds,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let runningWatch = false;

export async function runWatch(id: string): Promise<WatchRecord | null> {
  const rec = getWatch(id);
  if (!rec || !rec.enabled) return rec;
  const gate = canStartScan({ replace: false });
  if (!gate.ok) {
    rec.lastError = gate.error;
    persistWatch(rec);
    return rec;
  }
  runningWatch = true;
  try {
    const scan = await startScan({
      query: rec.query,
      mode: rec.mode,
      replace: false,
      profile: "lean",
      persist: false,
      source: "watch",
    });
    rec.lastScanId = scan.id;
    rec.lastRunAt = new Date().toISOString();
    rec.nextRunAt = new Date(Date.now() + rec.intervalMs).toISOString();
    rec.lastError = undefined;
    persistWatch(rec);
    const stored = await waitForScan(scan.id);
    const next = foundSnapshot(stored.rows);
    const diff = diffFounds(rec.lastFound, next);
    rec.lastFound = next;
    persistWatch(rec);
    if (diff.newFounds.length || (rec.lastFound.length > 0 && diff.goneFounds.length && next.length === 0)) {
      /* still alert on new founds only — gone-only is noisy */
    }
    if (diff.newFounds.length) {
      const alert: WatchAlert = {
        id: randomUUID(),
        watchId: rec.id,
        query: rec.query,
        mode: rec.mode,
        createdAt: new Date().toISOString(),
        newFounds: diff.newFounds,
        goneFounds: diff.goneFounds,
        read: false,
      };
      alert.webhookDelivered = await postWebhook(alert);
      persistAlert(alert);
    }
    return rec;
  } catch (err) {
    rec.lastError = err instanceof Error ? err.message : String(err);
    rec.nextRunAt = new Date(Date.now() + rec.intervalMs).toISOString();
    persistWatch(rec);
    return rec;
  } finally {
    runningWatch = false;
  }
}

export async function tickWatches(): Promise<void> {
  if (runningWatch) return;
  const gate = canStartScan({ replace: false });
  if (!gate.ok) return;
  const now = Date.now();
  const due = listWatches()
    .filter((w) => w.enabled && Date.parse(w.nextRunAt) <= now)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  const first = due[0];
  if (!first) return;
  await runWatch(first.id);
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startWatchScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tickWatches().catch(() => undefined);
  }, 30_000);
  timer.unref?.();
}

export function stopWatchScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test helper */
export function resetWatchesForTests(): void {
  memoryWatches.clear();
  memoryAlerts.splice(0, memoryAlerts.length);
  runningWatch = false;
}

export function watchesPersistMode(): "volume" | "memory" {
  return watchesDir() ? "volume" : "memory";
}
