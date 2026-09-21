import { useEffect, useState } from "react";
import { ListOrdered, Square, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchQueue } from "@shared/types";
import { BATCH_MAX_LINES } from "@shared/scan-limits";

export function BatchPanel({
  onBusy,
}: {
  onBusy?: (busy: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [queue, setQueue] = useState<BatchQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!queue || (queue.status !== "running" && queue.status !== "queued")) return;
    const t = setInterval(() => {
      void fetch(`/api/batch/${queue.id}`)
        .then(async (r) => (r.ok ? ((await r.json()) as BatchQueue) : null))
        .then((next) => {
          if (next) setQueue(next);
        })
        .catch(() => undefined);
    }, 800);
    return () => clearInterval(t);
  }, [queue?.id, queue?.status]);

  useEffect(() => {
    onBusy?.(queue?.status === "running" || queue?.status === "queued");
  }, [queue?.status, onBusy]);

  const start = async () => {
    setError(null);
    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, profile: "lean" }),
      });
      const data = (await res.json()) as BatchQueue & { error?: string };
      if (!res.ok) throw new Error(data.error || "Batch failed");
      setQueue(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const cancel = async () => {
    if (!queue) return;
    const res = await fetch(`/api/batch/${queue.id}/cancel`, { method: "POST" });
    if (res.ok) setQueue((await res.json()) as BatchQueue);
  };

  const done = queue?.jobs.filter((j) => j.status === "done").length ?? 0;
  const skipped = queue?.jobs.filter((j) => j.status === "skipped").length ?? 0;
  const total = queue?.jobs.length ?? 0;

  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <button
        type="button"
        className="tap-lg flex w-full items-center justify-between text-left text-xs uppercase tracking-wide text-fog-300"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-accent" />
          Batch recon queue
        </span>
        <span className="font-mono text-[10px] normal-case">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <>
          <p className="mt-2 text-sm text-fog-300">
            Paste emails, handles, hosts, or phones (one per line). Lean scans run serially (one at a time — 1 GB
            safe). Invalid lines are skipped. Combined export when the queue finishes.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={`octocat\npress@github.com\ngithub.com\n+14155552671\n# comments and blanks are skipped (max ${BATCH_MAX_LINES})`}
            className="mt-3 min-h-32 w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-xs text-fog-100"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" className="tap-lg" onClick={() => void start()} disabled={!text.trim()}>
              Queue lean scans
            </Button>
            {queue && (queue.status === "running" || queue.status === "queued") && (
              <Button size="sm" variant="outline" className="tap-lg border-signal-blocked text-signal-blocked" onClick={() => void cancel()}>
                <Square className="h-3.5 w-3.5" />
                Cancel queue
              </Button>
            )}
            {queue && (queue.status === "done" || queue.status === "cancelled") && (
              <>
                {(["json", "csv", "md"] as const).map((fmt) => (
                  <a key={fmt} href={`/api/batch/${queue.id}/export?format=${fmt}`}>
                    <Button type="button" size="sm" variant="outline" className="tap-lg">
                      <Download className="h-3.5 w-3.5" />
                      {fmt.toUpperCase()}
                    </Button>
                  </a>
                ))}
              </>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-signal-error">{error}</p>}
          {queue && (
            <div className="mt-3">
              <div className="font-mono text-[11px] text-fog-300">
                {queue.status} · {done}/{total} done · {skipped} skipped
              </div>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
                {queue.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap gap-2 font-mono text-[11px] text-fog-100">
                    <span className="text-fog-500">{j.status}</span>
                    <span>
                      {j.mode ?? "?"} · {j.query}
                    </span>
                    {j.found != null && <span className="text-signal-found">{j.found} found</span>}
                    {j.reason && <span className="text-fog-500">{j.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
