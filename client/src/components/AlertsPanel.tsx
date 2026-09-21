import { Bell, Eye, Play, Settings2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AlertChannelsPublic,
  AlertSetupPublic,
  AlertTestResult,
  ScanMode,
  WatchAlert,
  WatchRecord,
} from "@shared/types";

function ChannelRow({
  label,
  configured,
  vars,
  missing,
}: {
  label: string;
  configured: boolean;
  vars: string[];
  missing: string[];
}) {
  return (
    <li className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-fog-100">{label}</span>
        <span className={`font-mono text-[10px] uppercase ${configured ? "text-signal-found" : "text-fog-500"}`}>
          {configured ? "configured" : "not set"}
        </span>
      </div>
      <p className="mt-1 break-all font-mono text-[10px] text-fog-500">{vars.join(" · ")}</p>
      {!configured && missing.length > 0 && (
        <p className="mt-1 font-mono text-[10px] text-signal-blocked">needs {missing.join(" + ")}</p>
      )}
    </li>
  );
}

export function AlertsPanel({
  watches,
  alerts,
  persist,
  webhook,
  channels,
  setup,
  defaultQuery,
  defaultMode,
  onRefresh,
}: {
  watches: WatchRecord[];
  alerts: WatchAlert[];
  persist: "volume" | "memory";
  webhook: boolean;
  channels?: AlertChannelsPublic;
  setup?: AlertSetupPublic | null;
  defaultQuery?: string;
  defaultMode?: ScanMode;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState(defaultQuery ?? "");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

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
      if (!res.ok) throw new Error(data.error || "Watch could not be created. Check the query and try again.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ch = channels ?? setup?.channels ?? {
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
  const unread = alerts.filter((a) => !a.read).length;
  const timelineWatch = watches.find((w) => w.id === timelineId) ?? watches[0];
  const timeline = useMemo(
    () => [...(timelineWatch?.timeline ?? [])].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt)),
    [timelineWatch],
  );

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/alerts/test", { method: "POST" });
      const data = (await res.json()) as AlertTestResult & { error?: string };
      setTestMsg(data.message || data.error || (data.ok ? "Test sent." : "Test did not send."));
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const hints = setup?.hints;

  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <button
        type="button"
        className="tap-lg flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fog-300">
          <Bell className="h-4 w-4 text-accent" />
          Alerts / settings
          <span className="font-mono text-[10px] normal-case tracking-normal text-fog-300">
            {persist === "volume" ? "disk" : "memory"} ·{" "}
            {channelBits.length ? channelBits.join(" + ") : "in-app only"}
            {unread ? ` · ${unread} new` : ""}
          </span>
        </div>
        <span className="font-mono text-[10px] text-fog-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <>
          <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-fog-300">
              <Settings2 className="h-4 w-4 text-accent" />
              Channels
            </div>
            <p className="text-sm text-fog-300">
              {setup?.note ??
                "Set Railway Variables for outbound alerts. Secrets never appear here — Umbra only shows which channels are on."}
            </p>
            <ul className="mt-3 space-y-2">
              <ChannelRow
                label="Telegram"
                configured={ch.telegram}
                vars={hints?.telegram.vars ?? ["UMBRA_TELEGRAM_BOT_TOKEN", "UMBRA_TELEGRAM_CHAT_ID"]}
                missing={hints?.telegram.missing ?? (ch.telegram ? [] : ["UMBRA_TELEGRAM_BOT_TOKEN", "UMBRA_TELEGRAM_CHAT_ID"])}
              />
              <ChannelRow
                label="Resend email"
                configured={ch.resend}
                vars={hints?.resend.vars ?? ["RESEND_API_KEY", "UMBRA_ALERT_EMAIL"]}
                missing={hints?.resend.missing ?? []}
              />
              <ChannelRow
                label="SMTP email"
                configured={ch.smtp}
                vars={hints?.smtp.vars ?? ["UMBRA_SMTP_HOST", "UMBRA_ALERT_EMAIL"]}
                missing={hints?.smtp.missing ?? []}
              />
              <ChannelRow
                label="Webhook"
                configured={ch.webhook}
                vars={hints?.webhook.vars ?? ["UMBRA_ALERT_WEBHOOK"]}
                missing={hints?.webhook.missing ?? (ch.webhook ? [] : ["UMBRA_ALERT_WEBHOOK"])}
              />
              <ChannelRow
                label="Have I Been Pwned"
                configured={Boolean(setup?.hibp.configured)}
                vars={setup?.hibp.vars ?? ["HIBP_API_KEY"]}
                missing={setup?.hibp.configured ? [] : ["HIBP_API_KEY"]}
              />
            </ul>
            <Button type="button" size="sm" variant="outline" className="mt-3 tap-lg" disabled={testing} onClick={() => void runTest()}>
              {testing ? "Sending…" : "Test alert"}
            </Button>
            {testMsg && <p className="mt-2 text-sm text-fog-100">{testMsg}</p>}
          </div>
          <p className="mt-3 text-sm text-fog-300">
            Re-run a lean scan on an interval (minimum 1 hour, default 24h). New founds land here
            {channelBits.length ? ` and fan out to ${channelBits.join(", ")}` : ""}
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
        </>
      )}
    </section>
  );
}
