import { randomUUID } from "node:crypto";
import { SSE_FLUSH_MS, type ScanProfile } from "../shared/scan-limits.ts";
import type {
  DetectedKind,
  HostDossier,
  LedgerRow,
  MailDossier,
  PhoneDossier,
  ScanEvent,
  ScanMode,
  ScanProgress,
  ScanSummary,
} from "../shared/types.ts";
import {
  normalizeQuery,
  preflightHandle,
  preflightHost,
  preflightMail,
  preflightPhone,
  resolveMode,
} from "./detect.ts";
import { runHandleScan } from "./handle.ts";
import { buildMailDossier, hasMailExchanger, mailScanSiteCount, runMailScan } from "./mail.ts";
import { persistCompletedScan } from "./cases.ts";
import { HOST_LEDGER_COUNT, runHostScan } from "./host.ts";
import { PHONE_LEDGER_COUNT, runPhoneScan } from "./phone.ts";
import { hashFoundAvatars } from "./phash.ts";
import { buildIdentityGraph, compareScans } from "./graph.ts";
import { HostPool } from "./concurrency.ts";
import { clampPerHost, clampWorkers, maxConcurrentScans, resolveScanProfile, scanStaleMs } from "./limits.ts";
import { ScanAbortError, isHardMemoryPressure } from "./memory.ts";
import { loadSchema, sitesForScan } from "./schema.ts";

interface StoredScan {
  summary: ScanSummary;
  rows: LedgerRow[];
  listeners: Set<(event: ScanEvent) => void>;
  pool: HostPool | null;
  lastProgressAt: number;
  doneEmitted: boolean;
}

const scans = new Map<string, StoredScan>();

function emptyProgress(): ScanProgress {
  return { done: 0, total: 0, found: 0, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 };
}

function bump(progress: ScanProgress, status: LedgerRow["status"]): void {
  progress.done += 1;
  progress[status] += 1;
}

function emit(stored: StoredScan, event: ScanEvent): void {
  for (const fn of stored.listeners) {
    try {
      fn(event);
    } catch {
      /* ignore disconnected */
    }
  }
}

export function getScan(id: string): StoredScan | undefined {
  return scans.get(id);
}

export function listScans(): ScanSummary[] {
  return [...scans.values()].map((s) => s.summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function subscribe(id: string, fn: (event: ScanEvent) => void): () => void {
  const stored = scans.get(id);
  if (!stored) throw new Error("Unknown scan");
  stored.listeners.add(fn);
  fn({ type: "hello", scan: stored.summary });
  if (stored.rows.length) fn({ type: "rows", rows: stored.rows });
  if (stored.summary.dossier) fn({ type: "dossier", dossier: stored.summary.dossier });
  if (stored.summary.graph) fn({ type: "graph", graph: stored.summary.graph });
  if (stored.summary.avatarClusters?.length) fn({ type: "clusters", clusters: stored.summary.avatarClusters });
  fn({ type: "progress", progress: stored.summary.progress });
  if (stored.summary.status === "done" || stored.summary.status === "cancelled") fn({ type: "done", scan: stored.summary });
  return () => stored.listeners.delete(fn);
}

export function runningScanCount(): number {
  let n = 0;
  for (const s of scans.values()) {
    if (s.summary.status === "running") n += 1;
  }
  return n;
}

export function canStartScan(opts?: {
  replace?: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (isHardMemoryPressure()) {
    return { ok: false, status: 503, error: "memory pressure — retry shortly" };
  }
  const replace = opts?.replace !== false; // default true for interactive UI
  if (!replace && runningScanCount() >= maxConcurrentScans()) {
    return {
      ok: false,
      status: 409,
      error: "A scan is already running. 1 GB hosts keep one scan in flight.",
    };
  }
  return { ok: true };
}

function finishCancelled(stored: StoredScan, reason: string): void {
  if (stored.summary.status !== "running" && stored.summary.status !== "cancelled") return;
  stored.summary.status = "cancelled";
  stored.summary.abortReason = reason;
  if (!stored.summary.finishedAt) stored.summary.finishedAt = new Date().toISOString();
  if (!stored.doneEmitted) {
    stored.doneEmitted = true;
    emit(stored, { type: "progress", progress: stored.summary.progress });
    emit(stored, { type: "done", scan: stored.summary });
  }
}

/** Cancel one running scan. Returns the summary, or null if missing / not running. */
export function cancelScan(id: string, reason = "cancelled by user"): ScanSummary | null {
  const stored = scans.get(id);
  if (!stored) return null;
  if (stored.summary.status !== "running") {
    return stored.summary.status === "cancelled" ? stored.summary : null;
  }
  stored.pool?.abort(reason);
  finishCancelled(stored, reason);
  return stored.summary;
}

/** Cancel every running scan (used by replace semantics). */
export function cancelAllRunning(reason = "replaced by new scan"): ScanSummary[] {
  const out: ScanSummary[] = [];
  for (const stored of scans.values()) {
    if (stored.summary.status !== "running") continue;
    stored.pool?.abort(reason);
    finishCancelled(stored, reason);
    out.push(stored.summary);
  }
  return out;
}

function touchProgress(stored: StoredScan): void {
  stored.lastProgressAt = Date.now();
}

export async function startScan(input: {
  query: string;
  mode?: ScanMode;
  includeNsfw?: boolean;
  workers?: number;
  perHost?: number;
  /** When true (default), cancel any running scan so this one can start. */
  replace?: boolean;
  profile?: ScanProfile;
}): Promise<ScanSummary> {
  const replace = input.replace !== false;
  if (replace && runningScanCount() >= maxConcurrentScans()) {
    cancelAllRunning("replaced by new scan");
  }
  const requestedMode: ScanMode = input.mode ?? "auto";
  const kind: DetectedKind = resolveMode(input.query, requestedMode);
  const normalized = normalizeQuery(input.query, kind);
  const schema = loadSchema();
  const includeNsfw = Boolean(input.includeNsfw);
  const workers = clampWorkers(input.workers);
  const perHost = clampPerHost(input.perHost);
  const profile = resolveScanProfile(input.profile);

  let preflight = preflightHandle(normalized, schema.disposable);
  if (kind === "mail") {
    const mxOk = await hasMailExchanger(normalized.split("@")[1] ?? "");
    preflight = preflightMail(normalized, schema.disposable, mxOk);
  } else if (kind === "host") {
    preflight = preflightHost(normalized);
  } else if (kind === "phone") {
    preflight = preflightPhone(normalized);
  }

  const fullHandle = sitesForScan(includeNsfw, { profile: "full" }).length;
  const siteCount =
    kind === "handle"
      ? sitesForScan(includeNsfw, { profile }).length
      : kind === "mail"
        ? mailScanSiteCount(profile)
        : kind === "phone"
          ? PHONE_LEDGER_COUNT
          : HOST_LEDGER_COUNT;

  const profileNote =
    kind === "handle"
      ? profile === "lean"
        ? `Lean profile: ${siteCount} curated + high-signal sites (not the full ${fullHandle}-site map). Choose Full for the complete scan.`
        : `Full profile: ${siteCount} sites. Fast tier runs first, then the rest.`
      : kind === "mail"
        ? profile === "lean"
          ? `Lean mail: high-signal oracles first; quarantined and chronically blocked oracles skipped (${siteCount} checks).`
          : `Full mail: ${siteCount} silent oracles (high-signal first; quarantined still skipped without a probe).`
        : undefined;
  if (profileNote) preflight.notes = [...preflight.notes, profileNote];

  const id = randomUUID();
  const summary: ScanSummary = {
    id,
    query: normalized,
    mode: kind,
    requestedMode,
    createdAt: new Date().toISOString(),
    status: preflight.ok ? "running" : "done",
    preflight,
    progress: { ...emptyProgress(), total: preflight.ok ? siteCount : 0 },
    includeNsfw,
    siteCount,
    profile,
    profileNote,
  };
  const stored: StoredScan = { summary, rows: [], listeners: new Set(), pool: null, lastProgressAt: Date.now(), doneEmitted: false };
  scans.set(id, stored);

  if (!preflight.ok) {
    summary.finishedAt = new Date().toISOString();
    return summary;
  }

  queueMicrotask(() => {
    void execute(stored, workers, perHost, profile);
  });
  return summary;
}

async function execute(stored: StoredScan, workers: number, perHost: number, profile: ScanProfile): Promise<void> {
  let pending: LedgerRow[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flushRows = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.length === 1) emit(stored, { type: "row", row: pending[0] });
    else if (pending.length > 1) emit(stored, { type: "rows", rows: pending });
    pending = [];
    emit(stored, { type: "progress", progress: stored.summary.progress });
  };
  const onRow = (row: LedgerRow) => {
    if (stored.summary.status === "cancelled") return;
    stored.rows.push(row);
    bump(stored.summary.progress, row.status);
    touchProgress(stored);
    pending.push(row);
    if (row.status === "found" || pending.length >= 8) flushRows();
    else if (!timer) timer = setTimeout(flushRows, SSE_FLUSH_MS);
  };
  const onPool = (pool: HostPool) => {
    stored.pool = pool;
  };
  const shouldAbort = () => stored.summary.status === "cancelled";

  const flushProgress = () => {
    flushRows();
  };

  try {
    if (stored.summary.mode === "handle") {
      await runHandleScan(stored.summary.id, stored.summary.query, {
        includeNsfw: stored.summary.includeNsfw,
        workers,
        perHost,
        profile,
        onRow,
        onPool,
        onNotice: (message) => emit(stored, { type: "notice", message }),
      });
    } else if (stored.summary.mode === "mail") {
      const dossier = await buildMailDossier(stored.summary.query);
      stored.summary.dossier = dossier;
      emit(stored, { type: "dossier", dossier });
      onRow({
        id: `${stored.summary.id}:mx`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "MX",
        category: "identity",
        status: dossier.hasMx ? "found" : "miss",
        reason: dossier.hasMx
          ? dossier.mx.map((m) => `${m.priority} ${m.exchange}`).join(", ")
          : "No MX records",
        url: stored.summary.query.split("@")[1] ?? "",
        method: "DNS",
      });
      onRow({
        id: `${stored.summary.id}:disposable`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "Disposable",
        category: "identity",
        status: dossier.disposable ? "escalate" : "miss",
        reason: dossier.disposable ? "Domain is on the disposable-mail list." : "Not a known burn domain.",
        url: stored.summary.query.split("@")[1] ?? "",
        method: "LIST",
      });
      onRow({
        id: `${stored.summary.id}:spf`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "SPF",
        category: "dns",
        status: dossier.domainSpf.length ? "found" : "miss",
        reason: dossier.domainSpf[0]?.raw ?? "No v=spf1 TXT on the mail domain.",
        url: dossier.domain,
        method: "DNS",
      });
      onRow({
        id: `${stored.summary.id}:dmarc`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "DMARC",
        category: "dns",
        status: dossier.domainDmarc.length ? "found" : "miss",
        reason: dossier.domainDmarc[0]?.raw ?? `No TXT at _dmarc.${dossier.domain}`,
        url: `_dmarc.${dossier.domain}`,
        method: "DNS",
      });
      onRow({
        id: `${stored.summary.id}:tenant`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "M365 tenant",
        category: "identity",
        status: dossier.tenant?.namespace && dossier.tenant.namespace !== "Unknown" ? "found" : "miss",
        reason: dossier.tenant
          ? [dossier.tenant.namespace, dossier.tenant.federationBrand, dossier.tenant.domainName]
              .filter(Boolean)
              .join(" · ")
          : "GetUserRealm did not resolve a tenant.",
        url: `https://login.microsoftonline.com/GetUserRealm.srf?login=${encodeURIComponent(stored.summary.query)}`,
        method: "GET",
        metadata: dossier.tenant
          ? {
              displayName: dossier.tenant.federationBrand ?? dossier.tenant.domainName,
              extra: {
                namespace: dossier.tenant.namespace ?? "",
                cloud: dossier.tenant.cloud ?? "",
              },
            }
          : undefined,
      });
      onRow({
        id: `${stored.summary.id}:dkim`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "DKIM",
        category: "dns",
        status: dossier.dkim.length ? "found" : "miss",
        reason: dossier.dkim.length
          ? dossier.dkim.map((d) => d.selector).join(", ")
          : `No common DKIM selectors on ${dossier.domain}`,
        url: dossier.domain,
        method: "DNS",
      });
      onRow({
        id: `${stored.summary.id}:bimi`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "BIMI",
        category: "dns",
        status: dossier.bimi?.present ? "found" : "miss",
        reason: dossier.bimi?.present ? dossier.bimi.raw ?? "v=BIMI1" : `No TXT at default._bimi.${dossier.domain}`,
        url: `default._bimi.${dossier.domain}`,
        method: "DNS",
      });
      onRow({
        id: `${stored.summary.id}:gravatar`,
        scanId: stored.summary.id,
        mode: "mail",
        target: stored.summary.query,
        site: "Gravatar hash",
        category: "identity",
        status: dossier.gravatar?.exists ? "found" : "miss",
        reason: dossier.gravatar?.exists
          ? dossier.gravatar.displayName ?? "Public Gravatar profile"
          : "No public Gravatar profile (hash still useful for pivot).",
        url: `https://en.gravatar.com/${dossier.gravatar?.hash ?? ""}.json`,
        method: "GET",
        metadata: dossier.gravatar
          ? {
              displayName: dossier.gravatar.displayName,
              avatarUrl: dossier.gravatar.avatarUrl,
              extra: { md5: dossier.gravatar.hash, sha256: dossier.gravatar.sha256 ?? "" },
            }
          : undefined,
      });
      if (dossier.hibp?.enabled) {
        const names = dossier.hibp.breaches.slice(0, 8).map((b) => b.title || b.name);
        onRow({
          id: `${stored.summary.id}:hibp`,
          scanId: stored.summary.id,
          mode: "mail",
          target: stored.summary.query,
          site: "Have I Been Pwned",
          category: "identity",
          status: dossier.hibp.breachCount ? "found" : dossier.hibp.skipped ? "blocked" : "miss",
          reason: dossier.hibp.skipped
            ? dossier.hibp.skipped
            : dossier.hibp.breachCount
              ? `${dossier.hibp.breachCount} breach record(s)${names.length ? `: ${names.join(", ")}` : ""}`
              : "HIBP reports no breaches for this address.",
          url: `https://haveibeenpwned.com/account/${encodeURIComponent(stored.summary.query)}`,
          method: "GET",
          metadata: {
            extra: { breaches: dossier.hibp.breachCount },
          },
        });
      }
      stored.summary.progress.total = stored.summary.siteCount;
      await runMailScan(stored.summary.id, stored.summary.query, {
        workers,
        perHost,
        onRow,
        onPool,
        profile,
      });
    } else if (stored.summary.mode === "phone") {
      await runPhoneScan(stored.summary.id, stored.summary.query, {
        onRow,
        onDossier: (d: PhoneDossier) => {
          stored.summary.dossier = d;
          emit(stored, { type: "dossier", dossier: d });
        },
      });
    } else {
      await runHostScan(stored.summary.id, stored.summary.query, {
        onRow,
        onDossier: (d: HostDossier) => {
          stored.summary.dossier = d;
          emit(stored, { type: "dossier", dossier: d });
        },
      });
    }
    if (stored.summary.mode === "handle" || stored.summary.mode === "mail") {
      if (stored.summary.status !== "cancelled") {
        const hashed = await hashFoundAvatars(stored.rows);
        stored.summary.avatarClusters = hashed.clusters;
        if (hashed.clusters.length) emit(stored, { type: "clusters", clusters: hashed.clusters });
      }
    }
    if (stored.summary.status !== "cancelled") {
      stored.summary.graph = buildIdentityGraph({
        summary: stored.summary,
        rows: stored.rows,
        clusters: stored.summary.avatarClusters,
      });
      emit(stored, { type: "graph", graph: stored.summary.graph });
    }
  } catch (err) {
    if (err instanceof ScanAbortError) {
      stored.summary.status = "cancelled";
      stored.summary.abortReason = err.message;
    }
    emit(stored, { type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    flushProgress();
    stored.pool = null;
    if (stored.doneEmitted) return;
    if (stored.summary.status === "running") stored.summary.status = "done";
    if (!stored.summary.finishedAt) stored.summary.finishedAt = new Date().toISOString();
    stored.doneEmitted = true;
    if (stored.summary.status === "done") {
      try {
        persistCompletedScan(stored.summary, stored.rows, stored.summary.graph);
      } catch {
        /* optional persistence */
      }
    }
    emit(stored, { type: "done", scan: stored.summary });
  }
}

/** Auto-cancel scans that make no progress for scanStaleMs(). */
function sweepStaleScans(): void {
  const staleMs = scanStaleMs();
  const now = Date.now();
  for (const stored of scans.values()) {
    if (stored.summary.status !== "running") continue;
    if (now - stored.lastProgressAt < staleMs) continue;
    const mins = Math.round(staleMs / 60_000);
    const reason = `stale timeout — no progress for ${mins}m`;
    stored.pool?.abort(reason);
    finishCancelled(stored, reason);
  }
}

let staleTimer: ReturnType<typeof setInterval> | null = null;

export function startStaleScanWatchdog(): void {
  if (staleTimer) return;
  staleTimer = setInterval(() => {
    try {
      sweepStaleScans();
    } catch {
      /* ignore */
    }
  }, 30_000);
  // unref so the timer does not keep the process alive in tests
  staleTimer.unref?.();
}

// Start watchdog when this module loads in the server process.
startStaleScanWatchdog();


export function compareStored(aId: string, bId: string) {
  const a = scans.get(aId);
  const b = scans.get(bId);
  if (!a || !b) return null;
  return compareScans(a, b);
}

export type { MailDossier };
