import type { IdentityCluster } from "@shared/types";

function tone(n: number): string {
  if (n >= 0.8) return "text-signal-found";
  if (n >= 0.6) return "text-signal-blocked";
  return "text-fog-300";
}

export function IdentityClustersPanel({ clusters }: { clusters?: IdentityCluster[] | null }) {
  if (!clusters?.length) return null;
  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-fog-300">
        Same person? · {clusters.length} cluster{clusters.length === 1 ? "" : "s"}
      </div>
      <p className="mb-3 text-sm text-fog-300">
        Grouped by shared avatars (pHash), display names, cross-site handles, and websites. Confidence is a heuristic —
        not identity proof.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {clusters.map((c) => (
          <div key={c.id} className="rounded-lg border border-ink-700 bg-ink-950 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-fog-100">{c.label}</div>
                <div className="font-mono text-[10px] uppercase text-fog-500">{c.kind}</div>
              </div>
              <span className={`shrink-0 font-mono text-sm ${tone(c.confidence)}`}>
                {Math.round(c.confidence * 100)}%
              </span>
            </div>
            <p className="mt-2 text-[11px] text-fog-500">{c.reasons.join(" · ")}</p>
            <ul className="mt-2 space-y-1">
              {c.members.slice(0, 8).map((m) => (
                <li key={`${m.site}-${m.url}`} className="flex items-center gap-2">
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-ink-600 object-cover" />
                  ) : (
                    <span className="h-6 w-6 rounded-full border border-ink-600 bg-ink-800" />
                  )}
                  {m.url ? (
                    <a href={m.url} target="_blank" rel="noreferrer" className="truncate text-xs text-accent hover:underline">
                      {m.site}
                      {m.displayName ? ` · ${m.displayName}` : ""}
                    </a>
                  ) : (
                    <span className="truncate text-xs text-fog-100">{m.site}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
