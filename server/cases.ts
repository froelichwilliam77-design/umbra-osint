import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseNote, IdentityGraph, LedgerRow, SavedCase, ScanSummary } from "../shared/types.ts";
import { compareScans } from "../shared/compare.ts";
import { exportExecutiveHtml, exportJson, exportMarkdown } from "../shared/exports.ts";

const MAX_CASES = 24;
const MAX_FOUND_ROWS = 80;
const memory = new Map<string, SavedCase>();

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

function dataMount(): string {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || "/data";
}

/** Writable JSON dir, or null. Never throws — missing /data falls back to memory. */
export function casesDir(): string | null {
  try {
    const env = process.env.UMBRA_CASES_DIR?.trim();
    if (env) return canWrite(env) ? env : null;
    const mount = dataMount();
    const nested = join(mount, "cases");
    if (canWrite(nested)) return nested;
    const compat = join(mount, "umbra-cases");
    if (canWrite(compat)) return compat;
    return null;
  } catch {
    return null;
  }
}

export function casesPersistMode(): "volume" | "memory" {
  return casesDir() ? "volume" : "memory";
}

function slimRow(row: LedgerRow): LedgerRow {
  const { bodyExcerpt: _drop, ...rest } = row;
  return rest;
}

export function caseFromScan(summary: ScanSummary, rows: LedgerRow[], graph?: IdentityGraph): SavedCase {
  const foundRows = rows.filter((r) => r.status === "found").slice(0, MAX_FOUND_ROWS).map(slimRow);
  return {
    id: summary.id,
    query: summary.query,
    mode: summary.mode,
    savedAt: new Date().toISOString(),
    found: summary.progress.found,
    summary: { ...summary, graph: graph ?? summary.graph },
    foundRows,
    graph: graph ?? summary.graph,
    notes: [],
  };
}

function fileFor(dir: string, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(dir, `${safe}.json`);
}

function readDisk(dir: string, id: string): SavedCase | null {
  try {
    const raw = readFileSync(fileFor(dir, id), "utf8");
    return JSON.parse(raw) as SavedCase;
  } catch {
    return null;
  }
}

function writeDisk(dir: string, rec: SavedCase): void {
  writeFileSync(fileFor(dir, rec.id), JSON.stringify(rec));
}

function pruneDisk(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const rec = readDisk(dir, f.replace(/\.json$/, ""));
      return { f, rec, at: rec?.savedAt ?? "" };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const extra of files.slice(MAX_CASES)) {
    try {
      unlinkSync(join(dir, extra.f));
    } catch {
      /* ignore */
    }
  }
}

export function persistCase(rec: SavedCase): SavedCase {
  memory.set(rec.id, rec);
  if (memory.size > MAX_CASES) {
    const ordered = [...memory.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    for (const drop of ordered.slice(MAX_CASES)) memory.delete(drop.id);
  }
  const dir = casesDir();
  if (dir) {
    try {
      writeDisk(dir, rec);
      pruneDisk(dir);
    } catch {
      /* volume optional */
    }
  }
  return rec;
}

export function persistCompletedScan(summary: ScanSummary, rows: LedgerRow[], graph?: IdentityGraph): SavedCase {
  return persistCase(caseFromScan(summary, rows, graph));
}

export function getCase(id: string): SavedCase | null {
  const mem = memory.get(id);
  if (mem) return mem;
  const dir = casesDir();
  if (!dir) return null;
  const rec = readDisk(dir, id);
  if (rec) memory.set(id, rec);
  return rec;
}

export function listCases(): SavedCase[] {
  const dir = casesDir();
  if (dir) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        const rec = readDisk(dir, f.replace(/\.json$/, ""));
        if (rec) memory.set(rec.id, rec);
      }
    } catch {
      /* ignore */
    }
  }
  return [...memory.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_CASES);
}

export function appendCaseNote(
  caseId: string,
  text: string,
  via: CaseNote["via"] = "operator",
): SavedCase | null {
  const rec = getCase(caseId);
  if (!rec) return null;
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) throw new Error("note text is required");
  const notes = [...(rec.notes ?? [])];
  if (notes.length >= 40) notes.shift();
  notes.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    text: trimmed,
    via,
  });
  return persistCase({ ...rec, notes });
}

export function deleteCase(id: string): boolean {
  const had = memory.delete(id);
  const dir = casesDir();
  if (dir) {
    try {
      unlinkSync(fileFor(dir, id));
      return true;
    } catch {
      return had;
    }
  }
  return had;
}

export function compareCases(aId: string, bId: string) {
  const a = getCase(aId);
  const b = getCase(bId);
  if (!a || !b) return null;
  return compareScans(
    { summary: a.summary, rows: a.foundRows },
    { summary: b.summary, rows: b.foundRows },
  );
}

export function exportCase(id: string, format: string): { body: string; contentType: string; filename: string } | null {
  const rec = getCase(id);
  if (!rec) return null;
  const base = `umbra-case-${rec.mode}-${rec.query.replace(/[^\w.@+-]+/g, "_")}`;
  if (format === "md" || format === "markdown") {
    return {
      body: exportMarkdown(rec.summary, rec.foundRows, {
        notes: rec.notes,
        identityClusters: rec.summary.identityClusters,
      }),
      contentType: "text/markdown",
      filename: `${base}.md`,
    };
  }
  if (format === "html") {
    return {
      body: exportExecutiveHtml(rec.summary, rec.foundRows, {
        caseSavedAt: rec.savedAt,
        notes: rec.notes,
        identityClusters: rec.summary.identityClusters,
      }),
      contentType: "text/html",
      filename: `${base}.html`,
    };
  }
  return {
    body: exportJson(rec.summary, rec.foundRows),
    contentType: "application/json",
    filename: `${base}.json`,
  };
}

export function importCasePayload(payload: unknown): SavedCase {
  const rec = payload as Partial<SavedCase>;
  if (!rec || typeof rec !== "object") throw new Error("case JSON required");
  const summary = rec.summary as ScanSummary | undefined;
  if (!summary?.id || !summary.query || !summary.mode) throw new Error("case.summary is incomplete");
  const foundRows = Array.isArray(rec.foundRows) ? rec.foundRows : [];
  return persistCase({
    id: String(rec.id || summary.id),
    query: String(rec.query || summary.query),
    mode: summary.mode,
    savedAt: String(rec.savedAt || new Date().toISOString()),
    found: Number(rec.found ?? summary.progress?.found ?? foundRows.length),
    summary,
    foundRows,
    graph: rec.graph ?? summary.graph,
    notes: Array.isArray(rec.notes) ? rec.notes : [],
  });
}

/** Test helper */
export function resetCasesForTests(): void {
  memory.clear();
}
