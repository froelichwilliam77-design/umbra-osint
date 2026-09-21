import { AUTHORIZED_USE } from "@shared/constants";
import type { IdentityGraph, LedgerRow, SharedCaseView } from "@shared/types";
import { useEffect, useState } from "react";
import { GraphPanel } from "@/components/GraphPanel";
import { AvatarClustersPanel } from "@/components/AvatarClustersPanel";
import { Badge } from "@/components/ui/badge";

export function shareRouteFromLocation(
  path = window.location.pathname,
  search = window.location.search,
): { token: string; caseId?: string } | null {
  const clean = path.replace(/\/+$/, "") || "/";
  const share = clean.match(/^\/share\/([^/]+)$/);
  if (share) return { token: decodeURIComponent(share[1]) };
  const c = clean.match(/^\/c\/([^/]+)$/);
  if (c) {
    const token = new URLSearchParams(search).get("token");
    if (token) return { token, caseId: decodeURIComponent(c[1]) };
  }
  return null;
}

export function ShareView({ token, caseId }: { token: string; caseId?: string }) {
  const [view, setView] = useState<SharedCaseView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = caseId
      ? `/api/c/${encodeURIComponent(caseId)}?token=${encodeURIComponent(token)}`
      : `/api/share/${encodeURIComponent(token)}`;
    void fetch(url)
      .then(async (r) => {
        const data = (await r.json()) as SharedCaseView & { error?: string };
        if (!r.ok) throw new Error(data.error || "Share not found");
        setView(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [token, caseId]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Umbra share</p>
        <h1 className="mt-3 text-2xl text-white">Link unavailable</h1>
        <p className="mt-3 text-sm text-fog-300">{error}. It may have expired or been revoked.</p>
      </div>
    );
  }
  if (!view) {
    return <p className="p-8 font-mono text-sm text-fog-300">Loading shared case…</p>;
  }

  const graph: IdentityGraph | null = view.graph ?? null;
  const rows: LedgerRow[] = view.foundRows;

  return (
    <div className="min-h-screen px-3 py-4 md:px-6">
      <header className="mb-4 rounded-xl border border-ink-600 bg-ink-900/80 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent">Read-only share</p>
        <h1 className="mt-2 text-2xl text-white">
          {view.mode} · {view.query}
        </h1>
        <p className="mt-2 text-sm text-fog-300">
          {view.found} found · saved {new Date(view.savedAt).toLocaleString()}
          {view.expiresAt ? ` · expires ${new Date(view.expiresAt).toLocaleString()}` : " · no expiry"}
          {view.profile ? ` · ${view.profile}` : ""}
        </p>
        <p className="mt-3 text-xs text-fog-500">{AUTHORIZED_USE} Public-OSINT summary only — no private keys.</p>
      </header>
      {view.dossier && "email" in view.dossier && (
        <section className="mb-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fog-500">Mail dossier</div>
          <p className="mt-1 font-mono text-sm">{view.dossier.email}</p>
          <p className="text-xs text-fog-300">
            {view.dossier.providerGuess ?? "provider unknown"}
            {view.dossier.gravatar?.exists ? ` · Gravatar ${view.dossier.gravatar.displayName ?? "yes"}` : ""}
            {view.dossier.hibp?.enabled ? ` · HIBP ${view.dossier.hibp.breachCount}` : ""}
          </p>
        </section>
      )}
      {view.dossier && "dns" in view.dossier && "domain" in view.dossier && (
        <section className="mb-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fog-500">Host dossier</div>
          <p className="mt-1 font-mono text-sm">{view.dossier.domain}</p>
          <p className="text-xs text-fog-300">
            {view.dossier.rdap?.registrar ?? "no registrar"} · A {view.dossier.dns.a.join(", ") || "—"}
          </p>
        </section>
      )}
      {view.dossier && "e164" in view.dossier && (
        <section className="mb-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fog-500">Phone dossier</div>
          <p className="mt-1 font-mono text-sm">{view.dossier.e164 ?? view.dossier.raw}</p>
          <p className="text-xs text-fog-300">
            {view.dossier.country ?? "unknown"} · {view.dossier.type ?? "type unknown"}
          </p>
        </section>
      )}
      <AvatarClustersPanel clusters={view.avatarClusters} />
      <GraphPanel graph={graph} onPivot={() => undefined} interactive={false} />
      <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70">
        <div className="border-b border-ink-600 px-3 py-2 text-sm text-fog-300">Found rows · {rows.length}</div>
        <ul className="divide-y divide-ink-700">
          {rows.length === 0 && <li className="px-3 py-6 text-sm text-fog-500">No found rows in this share.</li>}
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Badge tone="found">found</Badge>
              <span className="text-sm text-fog-100">{r.site}</span>
              <a
                className="break-all font-mono text-[11px] text-accent hover:underline"
                href={r.profileUrl || r.url}
                target="_blank"
                rel="noreferrer"
              >
                {r.profileUrl || r.url}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
