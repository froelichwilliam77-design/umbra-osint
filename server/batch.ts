import { randomUUID } from "node:crypto";
import { BATCH_MAX_LINES } from "../shared/scan-limits.ts";
import type { BatchJob, BatchQueue, LedgerRow, ScanSummary } from "../shared/types.ts";
import { detectKind, preflightHandle, preflightHost, preflightMail, preflightPhone } from "./detect.ts";
import { loadSchema } from "./schema.ts";
import { cancelScan, canStartScan, getScan, startScan, waitForScan } from "./scans.ts";
import { exportCsv, exportMarkdown } from "./exports.ts";

const memory = new Map<string, BatchQueue>();
const MAX_BATCHES = 8;
let running = false;

function disposable(): Set<string> {
  try {
    return loadSchema().disposable;
  } catch {
    return new Set();
  }
}

export function parseBatchLines(text: string): BatchJob[] {
  const schema = disposable();
  const jobs: BatchJob[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (jobs.length >= BATCH_MAX_LINES) {
      jobs.push({
        id: randomUUID(),
        query: raw,
        raw,
        status: "skipped",
        reason: `Batch cap is ${BATCH_MAX_LINES} identifiers (1 GB safe).`,
      });
      continue;
    }
    const kind = detectKind(raw);
    if (kind === "crawl") {
      jobs.push({
        id: randomUUID(),
        query: raw,
        raw,
        mode: kind,
        status: "skipped",
        reason: "Batch queue is handle / mail / host / phone — skip crawl URLs.",
      });
      continue;
    }
    const pre =
      kind === "mail"
        ? preflightMail(raw, schema, null)
        : kind === "host"
          ? preflightHost(raw)
          : kind === "phone"
            ? preflightPhone(raw)
            : preflightHandle(raw.replace(/^@/, ""), schema);
    if (!pre.ok) {
      jobs.push({
        id: randomUUID(),
        query: raw,
        raw,
        mode: kind,
        status: "skipped",
        reason: pre.errors.join(" ") || "invalid",
      });
      continue;
    }
    const key = `${kind}:${pre.normalized.toLowerCase()}`;
    if (seen.has(key)) {
      jobs.push({
        id: randomUUID(),
        query: pre.normalized,
        raw,
        mode: kind,
        status: "skipped",
        reason: "duplicate",
      });
      continue;
    }
    seen.add(key);
    jobs.push({
      id: randomUUID(),
      query: pre.normalized,
      raw,
      mode: kind,
      status: "queued",
    });
  }
  return jobs;
}

function persist(queue: BatchQueue): BatchQueue {
  queue.updatedAt = new Date().toISOString();
  memory.set(queue.id, queue);
  if (memory.size > MAX_BATCHES) {
    const ordered = [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const drop of ordered.slice(MAX_BATCHES)) memory.delete(drop.id);
  }
  return queue;
}

export function createBatch(text: string, profile: "lean" | "full" = "lean"): BatchQueue {
  const jobs = parseBatchLines(text);
  if (!jobs.length) throw new Error("Paste at least one email, handle, host, or phone.");
  const now = new Date().toISOString();
  const queue: BatchQueue = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: jobs.some((j) => j.status === "queued") ? "queued" : "done",
    profile: profile === "full" ? "full" : "lean",
    jobs,
    currentIndex: 0,
  };
  persist(queue);
  return queue;
}

export function getBatch(id: string): BatchQueue | null {
  return memory.get(id) ?? null;
}

export function listBatches(): BatchQueue[] {
  return [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function cancelBatch(id: string): BatchQueue | null {
  const queue = memory.get(id);
  if (!queue) return null;
  if (queue.status === "done") return queue;
  queue.status = "cancelled";
  for (const job of queue.jobs) {
    if (job.status === "queued") {
      job.status = "cancelled";
      job.reason = "queue cancelled";
      job.finishedAt = new Date().toISOString();
    }
    if (job.status === "running" && job.scanId) {
      cancelScan(job.scanId, "batch cancelled");
      job.status = "cancelled";
      job.reason = "queue cancelled";
      job.finishedAt = new Date().toISOString();
    }
  }
  return persist(queue);
}

export async function runBatch(id: string): Promise<void> {
  if (running) return;
  const queue = memory.get(id);
  if (!queue || queue.status === "cancelled" || queue.status === "done") return;
  running = true;
  queue.status = "running";
  persist(queue);
  try {
    for (let i = 0; i < queue.jobs.length; i++) {
      const live = memory.get(id);
      if (!live || live.status === "cancelled") return;
      const job = live.jobs[i];
      live.currentIndex = i;
      if (job.status !== "queued") {
        persist(live);
        continue;
      }
      let gate = canStartScan({ replace: false });
      let waits = 0;
      while (!gate.ok && waits < 120) {
        await new Promise((r) => setTimeout(r, 500));
        if (memory.get(id)?.status === "cancelled") return;
        gate = canStartScan({ replace: false });
        waits += 1;
      }
      if (!gate.ok) {
        job.status = "error";
        job.reason = gate.error;
        job.finishedAt = new Date().toISOString();
        persist(live);
        continue;
      }
      job.status = "running";
      job.startedAt = new Date().toISOString();
      persist(live);
      try {
        const scan = await startScan({
          query: job.query,
          mode: job.mode,
          replace: false,
          profile: live.profile,
          persist: true,
          source: "batch",
        });
        job.scanId = scan.id;
        persist(live);
        const stored = await waitForScan(scan.id);
        const again = memory.get(id);
        if (!again) return;
        const cur = again.jobs[i];
        if (again.status === "cancelled") {
          cur.status = "cancelled";
          cur.reason = "queue cancelled";
        } else if (stored.summary.status === "cancelled") {
          cur.status = "cancelled";
          cur.reason = stored.summary.abortReason ?? "scan cancelled";
          again.status = "cancelled";
        } else {
          cur.status = "done";
          cur.found = stored.summary.progress.found;
        }
        cur.finishedAt = new Date().toISOString();
        persist(again);
        if (again.status === "cancelled") return;
      } catch (err) {
        job.status = "error";
        job.reason = err instanceof Error ? err.message : String(err);
        job.finishedAt = new Date().toISOString();
        persist(live);
      }
    }
    const done = memory.get(id);
    if (done && done.status === "running") {
      done.status = "done";
      persist(done);
    }
  } finally {
    running = false;
  }
}

export function batchResults(id: string): { summary: ScanSummary; rows: LedgerRow[] }[] {
  const queue = getBatch(id);
  if (!queue) return [];
  const out: { summary: ScanSummary; rows: LedgerRow[] }[] = [];
  for (const job of queue.jobs) {
    if (!job.scanId) continue;
    const stored = getScan(job.scanId);
    if (stored) out.push({ summary: stored.summary, rows: stored.rows });
  }
  return out;
}

export function exportBatch(
  id: string,
  format: string,
): { body: string; contentType: string; filename: string } | null {
  const queue = getBatch(id);
  if (!queue) return null;
  const results = batchResults(id);
  const base = `umbra-batch-${queue.id.slice(0, 8)}`;
  if (format === "csv") {
    const header =
      "query,mode,status,site,category,target,url,httpStatus,reason,profileUrl\n";
    const chunks = results.map(({ summary, rows }) => {
      const csv = exportCsv(rows);
      const lines = csv.split("\n").slice(1);
      return lines
        .filter(Boolean)
        .map((line) => `${csvEscape(summary.query)},${summary.mode},${line}`)
        .join("\n");
    });
    return {
      body: header + chunks.filter(Boolean).join("\n") + "\n",
      contentType: "text/csv",
      filename: `${base}.csv`,
    };
  }
  if (format === "md" || format === "markdown") {
    const parts = [
      `# Umbra batch`,
      "",
      `- Jobs: ${queue.jobs.length} · done ${queue.jobs.filter((j) => j.status === "done").length} · skipped ${queue.jobs.filter((j) => j.status === "skipped").length}`,
      `- Profile: **${queue.profile}** (serial, maxConcurrentScans=1)`,
      "",
    ];
    for (const job of queue.jobs) {
      parts.push(`## ${job.mode ?? "?"} · ${job.query}`, "");
      parts.push(`- Status: ${job.status}${job.reason ? ` (${job.reason})` : ""}`);
      if (job.found != null) parts.push(`- Found: ${job.found}`);
      parts.push("");
    }
    for (const { summary, rows } of results) {
      parts.push(exportMarkdown(summary, rows.filter((r) => r.status === "found")));
    }
    return { body: parts.join("\n"), contentType: "text/markdown", filename: `${base}.md` };
  }
  return {
    body: JSON.stringify(
      {
        batch: queue,
        scans: results.map(({ summary, rows }) => ({
          query: summary.query,
          mode: summary.mode,
          found: summary.progress.found,
          scanId: summary.id,
          scan: summary,
          foundRows: rows.filter((row) => row.status === "found"),
        })),
      },
      null,
      2,
    ),
    contentType: "application/json",
    filename: `${base}.json`,
  };
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

export function resetBatchesForTests(): void {
  memory.clear();
  running = false;
}
