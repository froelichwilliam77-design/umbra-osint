import { useMemo, useRef, useState } from "react";
import { FolderOpen, Trash2, Download, Upload, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IdentityGraph, LedgerRow, SavedCase, ScanCompare, ScanSummary } from "@shared/types";
import {
  compareLocalCases,
  deleteLocalCase,
  exportLocalCase,
  parseImportedCase,
  saveLocalCase,
} from "@/lib/cases";

export function CasesPanel({
  cases,
  onChange,
  onOpen,
  onCompare,
}: {
  cases: SavedCase[];
  onChange: (next: SavedCase[]) => void;
  onOpen: (rec: SavedCase) => void;
  onCompare: (diff: ScanCompare) => void;
}) {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);

  if (cases.length === 0) {
    return (
      <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs uppercase tracking-wide text-fog-300">Cases</div>
          <Button size="sm" variant="outline" className="tap-lg" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import JSON
          </Button>
        </div>
        <p className="mt-2 text-sm text-fog-300">
          Finished scans auto-save here (IndexedDB / this browser). Reopen yesterday’s case without a full re-scan.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const rec = parseImportedCase(JSON.parse(await file.text()));
              await saveLocalCase(rec);
              onChange([rec, ...cases.filter((c) => c.id !== rec.id)]);
            } catch (err) {
              window.alert(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-fog-300">Cases · {cases.length}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="tap-lg" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          <select
            className="tap-lg rounded-md border border-ink-600 bg-ink-900 px-2 font-mono text-[11px] text-fog-100"
            value={left}
            onChange={(e) => setLeft(e.target.value)}
          >
            <option value="">compare A…</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.mode} {c.query}
              </option>
            ))}
          </select>
          <select
            className="tap-lg rounded-md border border-ink-600 bg-ink-900 px-2 font-mono text-[11px] text-fog-100"
            value={right}
            onChange={(e) => setRight(e.target.value)}
          >
            <option value="">compare B…</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.mode} {c.query}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="tap-lg"
            disabled={!left || !right || left === right}
            onClick={() => {
              const a = byId.get(left);
              const b = byId.get(right);
              if (a && b) onCompare(compareLocalCases(a, b));
            }}
          >
            <GitCompare className="h-3.5 w-3.5" />
            Side by side
          </Button>
        </div>
      </div>
      <ul className="space-y-1">
        {cases.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-950 px-2 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-fog-100">
                {c.mode} · {c.query}
              </div>
              <div className="font-mono text-[10px] text-fog-300">
                {c.found} found · {new Date(c.savedAt).toLocaleString()}
              </div>
            </div>
            <Button size="sm" variant="outline" className="tap-lg" onClick={() => onOpen(c)}>
              <FolderOpen className="h-3.5 w-3.5" />
              Open
            </Button>
            <Button size="sm" variant="outline" className="tap-lg" onClick={() => exportLocalCase(c, "json")}>
              <Download className="h-3.5 w-3.5" />
              JSON
            </Button>
            <Button size="sm" variant="outline" className="tap-lg" onClick={() => exportLocalCase(c, "md")}>
              <Download className="h-3.5 w-3.5" />
              MD
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="tap-lg"
              onClick={async () => {
                await deleteLocalCase(c.id);
                onChange(cases.filter((x) => x.id !== c.id));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            const rec = parseImportedCase(JSON.parse(await file.text()));
            await saveLocalCase(rec);
            onChange([rec, ...cases.filter((c) => c.id !== rec.id)]);
          } catch (err) {
            window.alert(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </section>
  );
}

export function openSavedCase(rec: SavedCase): {
  scan: ScanSummary;
  rows: LedgerRow[];
  graph: IdentityGraph | null;
} {
  return {
    scan: { ...rec.summary, status: rec.summary.status === "running" ? "done" : rec.summary.status },
    rows: rec.foundRows,
    graph: rec.graph ?? rec.summary.graph ?? null,
  };
}
