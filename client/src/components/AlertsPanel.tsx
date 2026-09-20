import { Bell, Eye, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DetectedKind, ScanMode, WatchAlert, WatchRecord } from "@shared/types";

export function AlertsPanel({
  watches,
  alerts,
  persist,
  webhook,
  defaultQuery,
  defaultMode,
  onRefresh,
}: {
  watches: WatchRecord[];
  alerts: WatchAlert[];
  persist: "volume" | "memory";
  webhook: boolean;
  defaultQuery?: string;
  defaultMode?: ScanMode;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState(defaultQuery ?? "");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addWatch = async (q?: string, mode?: ScanMode) => {
    const target = (q ?? query).trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const intervalHours = Math.max(1, Number(hours) || 24);
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: target, mode: mode && mode !== "auto" && mode !== "crawl" ? mode : "auto", intervalHours }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Watch failed");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fog-300">
          <Bell className="h-4 w-4 text-accent" />
          Watches / alerts
          <span className="font-mono text-[10px] text-fog-300">
            {persist === "volume" ? "disk" : "memory"} · webhook {webhook ? "on" : "off"}
          </span>
        </div>
      </div>
      <p className="text-sm text-fog-300">
        Re-run a lean scan on an interval (minimum 1 hour, default 24h). New founds land here
        {webhook ? " and POST to UMBRA_ALERT_WEBHOOK" : " — set UMBRA_ALERT_WEBHOOK for outbound POSTs"}. No email or SMS.
      </p>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void addWatch();
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="handle, email, host, or phone"
          className="tap-lg flex-1"
        />
        <Input
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="tap-lg sm:w-24"
          inputMode="numeric"
          aria-label="Interval hours"
        />
        <Button type="submit" size="sm" className="tap-lg" disabled={busy}>
          <Eye className="h-3.5 w-3.5" />
          Watch
        </Button>
        {defaultQuery && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="tap-lg"
            disabled={busy || defaultMode === "crawl"}
            onClick={() => void addWatch(defaultQuery, defaultMode)}
          >
            Watch current
          </Button>
        )}
      </form>
      {error && <p className="mt-2 text-sm text-signal-error">{error}</p>}
      {watches.length === 0 ? (
        <p className="mt-3 text-sm text-fog-500">No watches yet.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {watches.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-950 px-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fog-100">
                  {w.mode} · {w.query}
                </div>
                <div className="font-mono text-[10px] text-fog-300">
                  every {Math.round(w.intervalMs / 36e5)}h · next {new Date(w.nextRunAt).toLocaleString()}
                  {w.lastError ? ` · ${w.lastError}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="tap-lg"
                onClick={async () => {
                  await fetch(`/api/watches/${w.id}/run`, { method: "POST" });
                  onRefresh();
                }}
              >
                <Play className="h-3.5 w-3.5" />
                Run
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="tap-lg"
                onClick={async () => {
                  await fetch(`/api/watches/${w.id}`, { method: "DELETE" });
                  onRefresh();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 text-xs uppercase tracking-wide text-fog-300">Alerts · {alerts.length}</div>
      {alerts.length === 0 ? (
        <p className="mt-2 text-sm text-fog-500">No new founds since the last snapshot.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {alerts.slice(0, 12).map((a) => (
            <li key={a.id} className={`rounded-lg border px-2 py-2 ${a.read ? "border-ink-700 text-fog-500" : "border-signal-found/40 bg-signal-found/5"}`}>
              <div className="text-sm text-fog-100">
                {a.mode} · {a.query} · {a.newFounds.length} new
              </div>
              <div className="font-mono text-[10px] text-fog-300">{new Date(a.createdAt).toLocaleString()}</div>
              <ul className="mt-1 font-mono text-[11px] text-signal-found">
                {a.newFounds.slice(0, 8).map((f) => (
                  <li key={`${f.site}-${f.url}`}>
                    {f.site} — {f.url}
                  </li>
                ))}
              </ul>
              {!a.read && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 tap-lg"
                  onClick={async () => {
                    await fetch(`/api/alerts/${a.id}/read`, { method: "POST" });
                    onRefresh();
                  }}
                >
                  Mark read
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { DetectedKind };
