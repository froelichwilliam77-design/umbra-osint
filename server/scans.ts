import { randomUUID } from "node:crypto";
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
import { buildMailDossier, hasMailExchanger, runMailScan } from "./mail.ts";
import { HOST_LEDGER_COUNT, runHostScan } from "./host.ts";
import { PHONE_LEDGER_COUNT, runPhoneScan } from "./phone.ts";
import { hashFoundAvatars } from "./phash.ts";
import { buildIdentityGraph, compareScans } from "./graph.ts";
import { loadSchema, sitesForScan } from "./schema.ts";

interface StoredScan {
  summary: ScanSummary;
  rows: LedgerRow[];
  listeners: Set<(event: ScanEvent) => void>;
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
  for (const row of stored.rows) fn({ type: "row", row });
  if (stored.summary.dossier) fn({ type: "dossier", dossier: stored.summary.dossier });
  if (stored.summary.graph) fn({ type: "graph", graph: stored.summary.graph });
  if (stored.summary.avatarClusters?.length) fn({ type: "clusters", clusters: stored.summary.avatarClusters });
  fn({ type: "progress", progress: stored.summary.progress });
  if (stored.summary.status === "done") fn({ type: "done", scan: stored.summary });
  return () => stored.listeners.delete(fn);
}

export async function startScan(input: {
  query: string;
  mode?: ScanMode;
  includeNsfw?: boolean;
  workers?: number;
  perHost?: number;
}): Promise<ScanSummary> {
  const requestedMode: ScanMode = input.mode ?? "auto";
  const kind: DetectedKind = resolveMode(input.query, requestedMode);
  const normalized = normalizeQuery(input.query, kind);
  const schema = loadSchema();
  const includeNsfw = Boolean(input.includeNsfw);
  const workers = Math.min(48, Math.max(4, input.workers ?? 24));
  const perHost = Math.min(4, Math.max(1, input.perHost ?? 2));

  let preflight = preflightHandle(normalized, schema.disposable);
  if (kind === "mail") {
    const mxOk = await hasMailExchanger(normalized.split("@")[1] ?? "");
    preflight = preflightMail(normalized, schema.disposable, mxOk);
  } else if (kind === "host") {
    preflight = preflightHost(normalized);
  } else if (kind === "phone") {
    preflight = preflightPhone(normalized);
  }

  const siteCount =
    kind === "handle"
      ? sitesForScan(includeNsfw).length
      : kind === "mail"
        ? schema.oracles.filter((o) => o.handler !== "hibp" || Boolean(process.env.HIBP_API_KEY?.trim())).length + 8
        : kind === "phone"
          ? PHONE_LEDGER_COUNT
          : HOST_LEDGER_COUNT;

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
  };
  const stored: StoredScan = { summary, rows: [], listeners: new Set() };
  scans.set(id, stored);

  if (!preflight.ok) {
    summary.finishedAt = new Date().toISOString();
    return summary;
  }

  queueMicrotask(() => {
    void execute(stored, workers, perHost);
  });
  return summary;
}

async function execute(stored: StoredScan, workers: number, perHost: number): Promise<void> {
  let sinceProgress = 0;
  const onRow = (row: LedgerRow) => {
    stored.rows.push(row);
    bump(stored.summary.progress, row.status);
    emit(stored, { type: "row", row });
    sinceProgress += 1;
    if (sinceProgress >= 8) {
      emit(stored, { type: "progress", progress: stored.summary.progress });
      sinceProgress = 0;
    }
  };
  const flushProgress = () => {
    emit(stored, { type: "progress", progress: stored.summary.progress });
    sinceProgress = 0;
  };

  try {
    if (stored.summary.mode === "handle") {
      await runHandleScan(stored.summary.id, stored.summary.query, {
        includeNsfw: stored.summary.includeNsfw,
        workers,
        perHost,
        onRow,
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
      stored.summary.progress.total = stored.summary.siteCount;
      await runMailScan(stored.summary.id, stored.summary.query, { workers, perHost, onRow });
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
      const hashed = await hashFoundAvatars(stored.rows);
      stored.summary.avatarClusters = hashed.clusters;
      if (hashed.clusters.length) emit(stored, { type: "clusters", clusters: hashed.clusters });
    }
    stored.summary.graph = buildIdentityGraph({
      summary: stored.summary,
      rows: stored.rows,
      clusters: stored.summary.avatarClusters,
    });
    emit(stored, { type: "graph", graph: stored.summary.graph });
  } catch (err) {
    emit(stored, { type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    flushProgress();
    stored.summary.status = "done";
    stored.summary.finishedAt = new Date().toISOString();
    emit(stored, { type: "done", scan: stored.summary });
  }
}

export function compareStored(aId: string, bId: string) {
  const a = scans.get(aId);
  const b = scans.get(bId);
  if (!a || !b) return null;
  return compareScans(a, b);
}

export type { MailDossier };
