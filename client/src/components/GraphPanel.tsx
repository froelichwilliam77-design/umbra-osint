import type { IdentityGraph, ScanCompare, ScanMode } from "@shared/types";
import { Button } from "@/components/ui/button";
import { GitCompare, Share2 } from "lucide-react";

export function GraphPanel({
  graph,
  onPivot,
}: {
  graph: IdentityGraph | null;
  onPivot: (query: string, mode: ScanMode) => void;
}) {
  if (!graph || graph.nodes.length === 0) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-fog-500">
        <Share2 className="h-4 w-4" />
        Identity graph
      </div>
      <div className="flex flex-wrap gap-2">
        {graph.nodes.slice(0, 40).map((n) => (
          <button
            key={n.id}
            className="tap-lg rounded-lg border border-ink-600 px-3 py-2 text-left"
            onClick={() => n.pivot && onPivot(n.pivot.query, n.pivot.mode)}
            disabled={!n.pivot}
          >
            <div className="font-mono text-[10px] uppercase text-fog-500">{n.kind}</div>
            <div className="max-w-[12rem] truncate text-sm text-fog-100">{n.label}</div>
          </button>
        ))}
      </div>
      <ul className="mt-3 max-h-28 space-y-1 overflow-auto font-mono text-[11px] text-fog-500">
        {graph.edges.slice(0, 24).map((e, i) => (
          <li key={`${e.from}-${e.to}-${i}`}>
            {byId.get(e.from)?.label} —{e.rel}→ {byId.get(e.to)?.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ComparePanel({
  compare,
  onClose,
}: {
  compare: ScanCompare | null;
  onClose: () => void;
}) {
  if (!compare) return null;
  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fog-500">
          <GitCompare className="h-4 w-4" />
          Compare {compare.a.query} vs {compare.b.query}
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="text-xs text-fog-500">
        Found {compare.a.found} vs {compare.b.found} · both {compare.both.length} · only A {compare.onlyA.length} · only
        B {compare.onlyB.length}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <div className="font-mono text-[10px] uppercase text-fog-500">Only A</div>
          {compare.onlyA.slice(0, 20).map((r) => (
            <p key={r.site} className="truncate text-xs text-fog-300">
              {r.site}
            </p>
          ))}
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-fog-500">Both</div>
          {compare.both.slice(0, 20).map((r) => (
            <p key={r.site} className="truncate text-xs text-signal-found">
              {r.site}
            </p>
          ))}
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-fog-500">Only B</div>
          {compare.onlyB.slice(0, 20).map((r) => (
            <p key={r.site} className="truncate text-xs text-fog-300">
              {r.site}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
