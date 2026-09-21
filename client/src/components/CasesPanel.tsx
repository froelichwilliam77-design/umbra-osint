import { useMemo, useRef, useState } from "react";
import { FolderOpen, Trash2, Download, Upload, GitCompare, Link2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyDialog } from "@/components/ConfirmDialog";
import type { CaseShare, IdentityGraph, LedgerRow, SavedCase, ScanCompare, ScanSummary } from "@shared/types";
import {
  compareLocalCases,
  deleteCaseHybrid,
  exportCaseHybrid,
  parseImportedCase,
  saveCaseHybrid,
  type CasesPersist,
} from "@/lib/cases";

export function CasesPanel({
  cases,
  persist = "local",
  onChange,
  onOpen,
  onCompare,
}: {
  cases: SavedCase[];
  persist?: CasesPersist;
  onChange: (next: SavedCase[]) => void;
  onOpen: (rec: SavedCase) => void;
  onCompare: (diff: ScanCompare) => void;
}) {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [shares, setShares] = useState<CaseShare[]>([]);
  const [shareHours, setShareHours] = useState("");
  const [shareBusy, setShareBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const persistLabel = persist === "volume" ? "server volume · all devices" : "this browser (IndexedDB)";

  const copyShare = async (rec: SavedCase, role: "read" | "write" = "read") => {
    setShareBusy(rec.id);
    try {
      if (persist !== "volume") {
        await fetch("/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case: rec }),
        });
      }
      const hours = shareHours.trim() ? Number(shareHours) : undefined;
      const res = await fetch(`/api/cases/${encodeURIComponent(rec.id)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresInHours: Number.isFinite(hours) && hours! > 0 ? hours : null,
          role,
        }),
      });
      const data = (await res.json()) as CaseShare & { path?: string; error?: string; accessCode?: string };
      if (!res.ok) throw new Error(data.error || "Share failed");
      const url = `${window.location.origin}${data.path ?? `/share/${data.token}`}`;
      const extra = data.accessCode ? `\nJoin code: ${data.accessCode}` : "";
      await navigator.clipboard.writeText(`${url}${extra}`).catch(() => undefined);
      setShareUrl(`${url}${extra}`);
      const listed = await fetch(`/api/cases/${encodeURIComponent(rec.id)}/shares`);
      if (listed.ok) {
        const body = (await listed.json()) as { shares?: CaseShare[] };
        setShares(body.shares ?? []);
      }
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err));
    } finally {
      setShareBusy(null);
    }
  };

  const onImport = async (file: File) => {
    const rec = parseImportedCase(JSON.parse(await file.text()));
    const saved = await saveCaseHybrid(rec, persist);
    onChange([saved, ...cases.filter((c) => c.id !== saved.id)]);
  };

  return (
    <section className="mt-4 scroll-mt-28 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      {shareUrl && <CopyDialog title="Share URL (copy)" value={shareUrl} onClose={() => setShareUrl(null)} />}
      <button
        type="button"
        className="tap-lg mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="text-xs uppercase tracking-wide text-fog-300">
          Cases · {cases.length}
          <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-fog-500">{persistLabel}</span>
        </div>
        <span className="font-mono text-[10px] text-fog-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="tap-lg" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          {cases.length > 0 && (
            <>
              <select
                className="tap-lg rounded-md border border-ink-600 bg-ink-900 px-2 font-mono text-[11px] text-fog-100"
                value={shareHours}
                onChange={(e) => setShareHours(e.target.value)}
                aria-label="Share expiry"
              >
                <option value="">share never expires</option>
                <option value="24">share 24h</option>
                <option value="168">share 7d</option>
                <option value="720">share 30d</option>
              </select>
              <select
                className="tap-lg hidden rounded-md border border-ink-600 bg-ink-900 px-2 font-mono text-[11px] text-fog-100 sm:block"
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
                className="tap-lg hidden rounded-md border border-ink-600 bg-ink-900 px-2 font-mono text-[11px] text-fog-100 sm:block"
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
                className="tap-lg hidden sm:inline-flex"
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
            </>
          )}
        </div>
      </div>
      {panelError && <p className="mb-2 text-sm text-signal-error">{panelError}</p>}
      {cases.length === 0 ? (
        <p className="mt-2 text-sm text-fog-300">
          Finished scans auto-save here. With a Railway volume at <code>/data</code> they survive restarts and sync
          across devices. Otherwise this browser’s IndexedDB is the fallback. Open / delete / export HTML (print to PDF),
          Markdown, or JSON.
        </p>
      ) : (
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
              <Button size="sm" variant="outline" className="tap-lg" onClick={() => exportCaseHybrid(c, "html", persist)}>
                <Download className="h-3.5 w-3.5" />
                Report
              </Button>
              <Button size="sm" variant="outline" className="tap-lg hidden sm:inline-flex" onClick={() => exportCaseHybrid(c, "md", persist)}>
                <Download className="h-3.5 w-3.5" />
                MD
              </Button>
              <Button size="sm" variant="outline" className="tap-lg hidden sm:inline-flex" onClick={() => exportCaseHybrid(c, "json", persist)}>
                <Download className="h-3.5 w-3.5" />
                JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="tap-lg"
                disabled={shareBusy === c.id}
                onClick={() => void copyShare(c)}
              >
                <Link2 className="h-3.5 w-3.5" />
                Share
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="tap-lg hidden sm:inline-flex"
                disabled={shareBusy === c.id}
                onClick={() => void copyShare(c, "write")}
              >
                <Link2 className="h-3.5 w-3.5" />
                Write share
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="tap-lg"
                onClick={async () => {
                  await deleteCaseHybrid(c.id, persist);
                  onChange(cases.filter((x) => x.id !== c.id));
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      {shares.filter((s) => !s.revokedAt).length > 0 && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950 p-2">
          <div className="text-[10px] uppercase tracking-wide text-fog-500">Live share links</div>
          <ul className="mt-1 space-y-1">
            {shares
              .filter((s) => !s.revokedAt)
              .map((s) => (
                <li key={s.token} className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-fog-300">
                  <a className="text-accent hover:underline" href={`/share/${s.token}`}>
                    /share/{s.token.slice(0, 10)}…
                  </a>
                  {s.expiresAt ? <span>exp {new Date(s.expiresAt).toLocaleDateString()}</span> : <span>no expiry</span>}
                  <span>{s.role === "write" ? "read-write" : "read-only"}</span>
                  {s.accessCode ? <span>code {s.accessCode}</span> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="tap-lg"
                    onClick={async () => {
                      await fetch(`/api/shares/${s.token}/revoke`, { method: "POST" });
                      setShares((prev) => prev.map((x) => (x.token === s.token ? { ...x, revokedAt: new Date().toISOString() } : x)));
                    }}
                  >
                    <Ban className="h-3 w-3" />
                    Revoke
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      )}
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
            await onImport(file);
          } catch (err) {
            setPanelError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
        </>
      )}
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
