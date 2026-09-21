import { Bell, Eye, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AlertChannelsPublic, ScanMode, WatchAlert, WatchRecord } from "@shared/types";

export function AlertsPanel({
  watches,
  alerts,
  persist,
  webhook,
  channels,
  defaultQuery,
  defaultMode,
  onRefresh,
}: {
  watches: WatchRecord[];
  alerts: WatchAlert[];
  persist: "volume" | "memory";
  webhook: boolean;
  channels?: AlertChannelsPublic;
  defaultQuery?: string;
  defaultMode?: ScanMode;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState(defaultQuery ?? "");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);

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
        body: JSON.stringify({
          query: target,
          mode: mode && mode !== "auto" && mode !== "crawl" ? mode : "auto",
          intervalHours,
        }),
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

  const ch = channels ?? {
    webhook,
    email: false,
    smtp: false,
    resend: false,
    telegram: false,
  };
  const channelBits = [
    ch.webhook ? "webhook" : null,
    ch.email ? (ch.resend ? "resend" : "smtp") : null,
    ch.telegram ? "telegram" : null,
  ].filter(Boolean);
  const timelineWatch = watches.find((w) => w.id === timelineId) ?? watches[0];
  const timeline = useMemo(
    () => [...(timelineWatch?.timeline ?? [])].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt)),
    [timelineWatch],
  );

  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fog-300">
          <Bell className="h-4 w-4 text-accent" />
          Watches / alerts
          <span className="font-mono text-[10px] text-fog-300">
            {persist === "volume" ? "disk" : "memory"} ·{" "}
            {channelBits.length ? channelBits.join(" + ") : "in-app only"}
          </span>
        </div>
      </div>
      <p className="text-sm text-fog-300">
        Re-run a lean scan on an interval (minimum 1 hour, default 24h). New founds land here
        {channelBits.length
          ? ` and fan out to ${channelBits.join(", ")}`
          : " — set UMBRA_ALERT_WEBHOOK, SMTP/Resend, and/or Telegram for outbound alerts"}
        . Operator inbox only. Never SMTP/SMS the subject.
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
                  {w.timeline?.length ? ` · ${w.timeline.length} first-seens` : ""}
                  {w.lastError ? ` · ${w.lastError}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" className="tap-lg" onClick={() => setTimelineId(w.id)}>
                Timeline
              </Button>
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
      {timelineWatch && timeline.length > 0 && (
        <div className="mt-4 rounded-lg border border-ink-700 bg-ink-950 p-3">
          <div className="text-xs uppercase tracking-wide text-fog-300">
            First-seen timeline · {timelineWatch.mode} {timelineWatch.query}
          </div>
          <ol className="mt-2 max-h-48 space-y-1 overflow-auto border-l border-ink-600 pl-3">
            {timeline.map((ev) => (
              <li key={`${ev.site}-${ev.url}`} className="relative">
                <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-signal-found" />
                <div className="text-sm text-fog-100">{ev.site}</div>
                <div className="font-mono text-[10px] text-fog-500">
                  first {new Date(ev.firstSeenAt).toLocaleString()}
                  {ev.lastSeenAt !== ev.firstSeenAt ? ` · last ${new Date(ev.lastSeenAt).toLocaleString()}` : ""}
                </div>
                <a className="break-all font-mono text-[10px] text-accent hover:underline" href={ev.url} target="_blank" rel="noreferrer">
                  {ev.url}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-4 text-xs uppercase tracking-wide text-fog-300">Alerts · {alerts.length}</div>
      {alerts.length === 0 ? (
        <p className="mt-2 text-sm text-fog-500">No new founds since the last snapshot.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {alerts.slice(0, 12).map((a) => (
            <li
              key={a.id}
              className={`rounded-lg border px-2 py-2 ${a.read ? "border-ink-700 text-fog-500" : "border-signal-found/40 bg-signal-found/5"}`}
            >
              <div className="text-sm text-fog-100">
                {a.mode} · {a.query} · {a.newFounds.length} new
              </div>
              <div className="font-mono text-[10px] text-fog-300">
                {new Date(a.createdAt).toLocaleString()}
                {a.channelsDelivered
                  ? ` · ${[
                      a.channelsDelivered.webhook ? "webhook" : null,
                      a.channelsDelivered.email ? "email" : null,
                      a.channelsDelivered.telegram ? "telegram" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "in-app"}`
                  : a.webhookDelivered
                    ? " · webhook"
                    : ""}
              </div>
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
