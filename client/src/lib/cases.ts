import { compareScans } from "@shared/compare";
import { exportExecutiveHtml, exportJson, exportMarkdown } from "@shared/exports";
import type { IdentityGraph, LedgerRow, SavedCase, ScanSummary } from "@shared/types";

const DB = "umbra-cases";
const STORE = "cases";
const LS_KEY = "umbra.cases.v2";
const MAX_CASES = 24;
const MAX_FOUND_ROWS = 80;

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
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function lsLoad(): SavedCase[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedCase[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsSave(cases: SavedCase[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cases.slice(0, MAX_CASES)));
  } catch {
    try {
      const slim = cases.slice(0, 8).map((c) => ({
        ...c,
        foundRows: c.foundRows.slice(0, 24),
        summary: { ...c.summary, dossier: c.summary.dossier },
      }));
      localStorage.setItem(LS_KEY, JSON.stringify(slim));
    } catch {
      /* quota */
    }
  }
}

export async function listLocalCases(): Promise<SavedCase[]> {
  try {
    const db = await openDb();
    const rows = await new Promise<SavedCase[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as SavedCase[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (rows.length) {
      return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_CASES);
    }
  } catch {
    /* IndexedDB unavailable */
  }
  return lsLoad().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveLocalCase(rec: SavedCase): Promise<SavedCase> {
  const all = await listLocalCases();
  const merged = [rec, ...all.filter((c) => c.id !== rec.id)].slice(0, MAX_CASES);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(STORE);
      store.put(rec);
      for (const drop of all.slice(MAX_CASES - 1)) {
        if (drop.id !== rec.id) store.delete(drop.id);
      }
    });
    db.close();
  } catch {
    /* fall through to localStorage */
  }
  lsSave(merged);
  return rec;
}

export async function deleteLocalCase(id: string): Promise<void> {
  const all = (await listLocalCases()).filter((c) => c.id !== id);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(id);
    });
    db.close();
  } catch {
    /* ignore */
  }
  lsSave(all);
}

export type CasesPersist = "volume" | "local";

export async function loadCases(): Promise<{ persist: CasesPersist; cases: SavedCase[] }> {
  try {
    const res = await fetch("/api/cases");
    if (res.ok) {
      const data = (await res.json()) as { persist?: string; cases?: SavedCase[] };
      if (data.persist === "volume") {
        return { persist: "volume", cases: Array.isArray(data.cases) ? data.cases : [] };
      }
    }
  } catch {
    /* IndexedDB fallback */
  }
  return { persist: "local", cases: await listLocalCases() };
}

export async function saveCaseHybrid(
  rec: SavedCase,
  persist: CasesPersist,
  scanId?: string,
): Promise<SavedCase> {
  if (persist === "volume") {
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanId ? { scanId } : { case: rec }),
      });
      if (res.ok) return (await res.json()) as SavedCase;
    } catch {
      /* fall through */
    }
  }
  return saveLocalCase(rec);
}

export async function deleteCaseHybrid(id: string, persist: CasesPersist): Promise<void> {
  if (persist === "volume") {
    try {
      await fetch(`/api/cases/${id}`, { method: "DELETE" });
    } catch {
      /* still drop local */
    }
  }
  await deleteLocalCase(id);
}

export function downloadText(filename: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportLocalCase(rec: SavedCase, format: "json" | "md" | "html"): void {
  const base = `umbra-case-${rec.mode}-${rec.query.replace(/[^\w.@+-]+/g, "_")}`;
  if (format === "html") {
    downloadText(`${base}.html`, exportExecutiveHtml(rec.summary, rec.foundRows, {
      caseSavedAt: rec.savedAt,
      notes: rec.notes,
      identityClusters: rec.summary.identityClusters,
    }), "text/html");
    return;
  }
  if (format === "md") {
    downloadText(`${base}.md`, exportMarkdown(rec.summary, rec.foundRows, {
      notes: rec.notes,
      identityClusters: rec.summary.identityClusters,
    }), "text/markdown");
    return;
  }
  downloadText(`${base}.json`, exportJson(rec.summary, rec.foundRows), "application/json");
}

export function exportCaseHybrid(rec: SavedCase, format: "json" | "md" | "html", persist: CasesPersist): void {
  if (persist === "volume") {
    const a = document.createElement("a");
    a.href = `/api/cases/${encodeURIComponent(rec.id)}/export?format=${format}`;
    a.download = "";
    a.click();
    return;
  }
  exportLocalCase(rec, format);
}

export function compareLocalCases(a: SavedCase, b: SavedCase) {
  return compareScans({ summary: a.summary, rows: a.foundRows }, { summary: b.summary, rows: b.foundRows });
}

export function parseImportedCase(payload: unknown): SavedCase {
  const rec = payload as Partial<SavedCase> & { scan?: ScanSummary; rows?: LedgerRow[] };
  if (rec.summary && Array.isArray(rec.foundRows)) {
    return {
      id: String(rec.id || rec.summary.id),
      query: String(rec.query || rec.summary.query),
      mode: rec.summary.mode,
      savedAt: String(rec.savedAt || new Date().toISOString()),
      found: Number(rec.found ?? rec.summary.progress?.found ?? rec.foundRows.length),
      summary: rec.summary,
      foundRows: rec.foundRows,
      graph: rec.graph ?? rec.summary.graph,
    };
  }
  if (rec.scan && Array.isArray(rec.rows)) {
    return caseFromScan(rec.scan, rec.rows, rec.scan.graph);
  }
  throw new Error("Not a saved Umbra case (need summary + foundRows, or scan + rows).");
}
