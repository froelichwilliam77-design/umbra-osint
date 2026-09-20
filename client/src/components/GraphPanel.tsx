import type { IdentityGraph, ScanCompare, ScanMode } from "@shared/types";
import { Button } from "@/components/ui/button";
import { GitCompare, Share2, Waypoints } from "lucide-react";

const KIND_TONE: Record<string, string> = {
  mail: "border-accent/50 bg-accent/10",
  handle: "border-signal-found/40 bg-signal-found/10",
  host: "border-accent/40 bg-accent/10",
  phone: "border-signal-blocked/40 bg-signal-blocked/10",
  profile: "border-ink-600 bg-ink-950",
  oracle: "border-signal-escalate/40 bg-signal-escalate/10",
  avatar: "border-ink-600 bg-ink-800",
};

export function GraphPanel({
  graph,
  onPivot,
  onRunPivots,
}: {
  graph: IdentityGraph | null;
  onPivot: (query: string, mode: ScanMode) => void;
  onRunPivots?: () => void;
}) {
  if (!graph || !graph.nodes?.length) return null;
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pivotable = nodes.filter((n) => n.pivot);
  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fog-300">
          <Share2 className="h-4 w-4 text-accent" />
          Identity graph
          <span className="font-mono text-[10px] text-fog-300">
            {nodes.length} nodes · {edges.length} edges
          </span>
        </div>
        {onRunPivots && (
          <Button size="sm" variant="outline" className="tap-lg" onClick={onRunPivots}>
            <Waypoints className="h-3.5 w-3.5" />
            Run pivots
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {nodes.slice(0, 48).map((n) => (
          <button
            key={n.id}
            className={`tap-lg rounded-lg border px-3 py-2 text-left ${KIND_TONE[n.kind] ?? "border-ink-600"} ${
              n.pivot ? "" : "opacity-80"
            }`}
            onClick={() => n.pivot && onPivot(n.pivot.query, n.pivot.mode)}
            disabled={!n.pivot}
          >
            <div className="font-mono text-[10px] uppercase text-fog-300">
              {n.kind}
              {n.status ? ` · ${n.status}` : ""}
            </div>
            <div className="max-w-[12rem] truncate text-sm text-fog-100">{n.label}</div>
          </button>
        ))}
      </div>
      {pivotable.length > 0 && (
        <p className="mt-2 font-mono text-[11px] text-fog-300">
          Tap a handle or host node to recon it. {pivotable.length} pivotable.
        </p>
      )}
      <ul className="mt-3 max-h-28 space-y-1 overflow-auto font-mono text-[11px] text-fog-300">
        {edges.slice(0, 32).map((e, i) => (
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
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fog-300">
          <GitCompare className="h-4 w-4" />
          Compare {compare.a.mode} {compare.a.query} vs {compare.b.mode} {compare.b.query}
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="text-xs text-fog-300">
        Found {compare.a.found} vs {compare.b.found} · both {compare.both.length} · only A {compare.onlyA.length} · only
        B {compare.onlyB.length}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-ink-700 bg-ink-950 p-2">
          <div className="font-mono text-[10px] uppercase text-fog-300">Only A · {compare.a.query}</div>
          {compare.onlyA.length === 0 && <p className="text-xs text-fog-300">None</p>}
          {compare.onlyA.slice(0, 40).map((r) => (
            <p key={r.site} className="truncate text-xs text-fog-100">
              {r.site}
            </p>
          ))}
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-950 p-2">
          <div className="font-mono text-[10px] uppercase text-fog-300">Both</div>
          {compare.both.length === 0 && <p className="text-xs text-fog-300">None</p>}
          {compare.both.slice(0, 40).map((r) => (
            <p key={r.site} className="truncate text-xs text-signal-found">
              {r.site}
            </p>
          ))}
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-950 p-2">
          <div className="font-mono text-[10px] uppercase text-fog-300">Only B · {compare.b.query}</div>
          {compare.onlyB.length === 0 && <p className="text-xs text-fog-300">None</p>}
          {compare.onlyB.slice(0, 40).map((r) => (
            <p key={r.site} className="truncate text-xs text-fog-100">
              {r.site}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
