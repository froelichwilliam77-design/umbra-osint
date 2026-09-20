import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Download,
  Fingerprint,
  Globe,
  Mail,
  Phone,
  Radar,
  Search,
  Share2,
  ShieldAlert,
  Smartphone,
  UserRound,
  X,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ComparePanel, GraphPanel } from "@/components/GraphPanel";
import type {
  HostDossier,
  IdentityGraph,
  LedgerRow,
  LedgerStatus,
  MailDossier,
  PhoneDossier,
  ScanCompare,
  ScanEvent,
  ScanMode,
  ScanProgress,
  ScanSummary,
  SchemaStats,
} from "@shared/types";
import { AUTHORIZED_USE } from "@shared/constants";

const STATUSES: LedgerStatus[] = ["found", "miss", "blocked", "escalate", "error", "invalid"];

const STATUS_COLOR: Record<LedgerStatus, string> = {
  found: "text-signal-found",
  miss: "text-signal-miss",
  blocked: "text-signal-blocked",
  escalate: "text-signal-escalate",
  error: "text-signal-error",
  invalid: "text-signal-invalid",
};

const STATUS_WHY: Record<LedgerStatus, string> = {
  found: "A registration or profile oracle reported this identifier is taken, or a public profile exists.",
  miss: "The oracle reported the identifier is unused, or the profile is absent (404 / soft-404 / empty payload).",
  blocked:
    "The endpoint refused the probe (403, 401, 429, CAPTCHA, WAF, CSRF, or quarantined). This is not a miss — the account may still exist.",
  escalate:
    "The response was real but neither a present nor a missing matcher fired. Read the reason and body excerpt; this should be rare after recovery.",
  error: "The request failed (timeout, DNS, or upstream 5xx).",
  invalid: "The query was skipped for this target (regex, SSRF, or preflight).",
};

type FilterMode = LedgerStatus | "all" | "hits";

function isMail(d: ScanSummary["dossier"]): d is MailDossier {
  return Boolean(d && "email" in d);
}
function isHost(d: ScanSummary["dossier"]): d is HostDossier {
  return Boolean(d && "domain" in d && !("email" in d));
}
function isPhone(d: ScanSummary["dossier"]): d is PhoneDossier {
  return Boolean(d && "e164" in d);
}

type SavedCase = {
  id: string;
  query: string;
  mode: ScanSummary["mode"];
  savedAt: string;
  found: number;
};

function loadCases(): SavedCase[] {
  try {
    return JSON.parse(localStorage.getItem("umbra.cases") || "[]") as SavedCase[];
  } catch {
    return [];
  }
}

function storeCases(cases: SavedCase[]): void {
  localStorage.setItem("umbra.cases", JSON.stringify(cases.slice(0, 8)));
}

export default function App() {
  const [accepted, setAccepted] = useState(() => localStorage.getItem("umbra.ok") === "1");
  const [query, setQuery] = useState("octocat");
  const [mode, setMode] = useState<ScanMode>("auto");
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("found");
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [schema, setSchema] = useState<SchemaStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState<IdentityGraph | null>(null);
  const [cases, setCases] = useState<SavedCase[]>(() => loadCases());
  const [compare, setCompare] = useState<ScanCompare | null>(null);
  const [installEvent, setInstallEvent] = useState<{ prompt: () => Promise<unknown> } | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const pendingRef = useRef<LedgerRow[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void fetch("/api/schema")
      .then((r) => r.json())
      .then(setSchema)
      .catch(() => setSchema(null));
  }, []);

  useEffect(() => {
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as unknown as { prompt: () => Promise<unknown> });
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(
    () => () => {
      sourceRef.current?.close();
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  const flushRows = () => {
    const batch = pendingRef.current;
    pendingRef.current = [];
    flushTimer.current = undefined;
    if (!batch.length) return;
    setRows((prev) => prev.concat(batch));
    setSelected((cur) => cur ?? batch.find((r) => r.status === "found") ?? batch[0]);
  };

  const queueRow = (row: LedgerRow) => {
    pendingRef.current.push(row);
    if (flushTimer.current == null) {
      flushTimer.current = window.setTimeout(flushRows, 50);
    }
  };

  const start = async (override?: { query?: string; mode?: ScanMode }) => {
    const q = (override?.query ?? query).trim();
    if (!q) return;
    setError(null);
    setBusy(true);
    pendingRef.current = [];
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    setRows([]);
    setSelected(null);
    setInspectorOpen(false);
    setFilter("found");
    setCategory("all");
    setSearch("");
    setGraph(null);
    setCompare(null);
    sourceRef.current?.close();
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          mode: override?.mode ?? mode,
          includeNsfw,
        }),
      });
      const data = (await res.json()) as ScanSummary & { error?: string };
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setScan(data);
      if (!data.preflight.ok) {
        setBusy(false);
        setError(data.preflight.errors.join(" "));
        return;
      }
      const es = new EventSource(`/api/scans/${data.id}/events`);
      sourceRef.current = es;
      es.onmessage = (ev) => {
        const event = JSON.parse(ev.data) as ScanEvent;
        if (event.type === "hello") setScan(event.scan);
        if (event.type === "row") queueRow(event.row);
        if (event.type === "dossier" || event.type === "done") {
          if (event.type === "done") flushRows();
          setScan(event.type === "done" ? event.scan : (s) => (s ? { ...s, dossier: event.dossier } : s));
        }
        if (event.type === "progress") {
          setScan((s) => (s ? { ...s, progress: event.progress } : s));
        }
        if (event.type === "graph") setGraph(event.graph);
        if (event.type === "clusters") {
          setScan((s) => (s ? { ...s, avatarClusters: event.clusters } : s));
        }
        if (event.type === "error") setError(event.message);
        if (event.type === "done") {
          setBusy(false);
          es.close();
        }
      };
      es.onerror = () => {
        flushRows();
        setBusy(false);
        es.close();
      };
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pivotHandle = (handle: string) => {
    setQuery(handle);
    setMode("handle");
    void start({ query: handle, mode: "handle" });
  };

  const pivotTo = (q: string, m: ScanMode) => {
    setQuery(q);
    setMode(m);
    void start({ query: q, mode: m });
  };

  const saveCase = () => {
    if (!scan) return;
    const next: SavedCase = {
      id: scan.id,
      query: scan.query,
      mode: scan.mode,
      savedAt: new Date().toISOString(),
      found: scan.progress.found,
    };
    const merged = [next, ...cases.filter((c) => c.id !== next.id)].slice(0, 8);
    setCases(merged);
    storeCases(merged);
  };

  const runCompare = async (otherId: string) => {
    if (!scan) return;
    const res = await fetch(`/api/scans/compare?a=${encodeURIComponent(scan.id)}&b=${encodeURIComponent(otherId)}`);
    if (!res.ok) {
      setError("Compare needs both scans still in this browser session (in-memory). Save, then run the second recon before leaving.");
      return;
    }
    setCompare((await res.json()) as ScanCompare);
  };

  const cats = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.category, (c.get(r.category) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = rows.filter((r) => {
      if (filter === "hits" && r.status !== "found" && r.status !== "blocked" && r.status !== "escalate") {
        return false;
      }
      if (filter !== "all" && filter !== "hits" && r.status !== filter) return false;
      if (category !== "all" && r.category !== category) return false;
      if (q) {
        return (
          r.site.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q) ||
          (r.metadata?.displayName ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
    return filtered.sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rank !== 0) return rank;
      return a.site.localeCompare(b.site);
    });
  }, [rows, filter, category, search]);

  const progress: ScanProgress | undefined = scan?.progress;
  const hitCount = (progress?.found ?? 0) + (progress?.blocked ?? 0) + (progress?.escalate ?? 0);

  const openRow = (row: LedgerRow) => {
    setSelected(row);
    setInspectorOpen(true);
  };

  if (!accepted) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Umbra</p>
        <h1 className="mt-3 text-3xl font-medium">Authorized use only</h1>
        <p className="mt-4 text-fog-300">{AUTHORIZED_USE}</p>
        <p className="mt-3 text-sm text-fog-500">
          Handle, mail, host, and phone modules query public endpoints. Private/loopback fetches are blocked. Silent
          mail oracles never SMTP the subject. Phone mode never sends SMS.
        </p>
        <Button
          className="mt-8 w-fit"
          onClick={() => {
            localStorage.setItem("umbra.ok", "1");
            setAccepted(true);
          }}
        >
          I am authorized — open the ledger
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-3 py-4 md:px-6">
      <header className="sticky top-0 z-20 -mx-3 mb-4 border-b border-ink-700/80 bg-ink-950/90 px-3 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-accent" />
              <h1 className="text-lg font-medium tracking-wide">Umbra</h1>
              <Badge tone="muted">public OSINT</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-fog-500">
              {schema
                ? `${schema.handleSites} handle sites · ${schema.oracles} mail oracles · ${schema.disposableDomains} disposable domains${schema.sherlockSites ? ` · ${schema.sherlockSites} Sherlock overlay` : ""}`
                : "Loading schema…"}
            </p>
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-fog-500 md:flex">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-signal-blocked" />
            <span className="max-w-md leading-snug">{AUTHORIZED_USE}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {installEvent && (
            <Button
              size="sm"
              variant="outline"
              className="tap-lg"
              onClick={() => {
                void installEvent.prompt();
                setInstallEvent(null);
              }}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Add to Home Screen
            </Button>
          )}
          {scan && (
            <Button size="sm" variant="outline" className="tap-lg" onClick={saveCase}>
              Save case
            </Button>
          )}
          {cases.length > 0 && scan && (
            <label className="flex items-center gap-2 font-mono text-[11px] text-fog-500">
              Compare with
              <select
                className="tap-lg rounded-md border border-ink-600 bg-ink-900 px-2 text-fog-100"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void runCompare(e.target.value);
                }}
              >
                <option value="">saved run…</option>
                {cases
                  .filter((c) => c.id !== scan.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.mode} {c.query} ({c.found} found)
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <section className="sticky top-[4.5rem] z-10 rounded-xl border border-ink-600 bg-ink-900/95 p-3 shadow-panel backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["auto", "Auto"],
              ["handle", "Handle"],
              ["mail", "Mail"],
              ["host", "Host"],
              ["phone", "Phone"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`tap-lg rounded-full border px-4 py-2 font-mono text-xs uppercase tracking-wide ${
                mode === id
                  ? "border-accent bg-accent/15 text-fog-100"
                  : "border-ink-600 text-fog-500 hover:border-fog-500"
              }`}
            >
              {label}
            </button>
          ))}
          <label className="ml-auto flex min-h-11 items-center gap-2 font-mono text-[11px] text-fog-500">
            <input
              type="checkbox"
              checked={includeNsfw}
              onChange={(e) => setIncludeNsfw(e.target.checked)}
            />
            NSFW
          </label>
        </div>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-fog-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="octocat · press@github.com · github.com · +14155552671"
              className="tap-lg pl-9"
              autoFocus
              inputMode={mode === "phone" ? "tel" : "text"}
            />
          </div>
          <Button type="submit" size="lg" disabled={busy} className="tap-lg w-full sm:w-auto">
            {busy ? "Recon…" : "Recon"}
          </Button>
        </form>
        {scan && (
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-fog-300">
            <span>
              detected <strong className="text-fog-100">{scan.mode}</strong>
              {scan.requestedMode !== scan.mode ? ` (from ${scan.requestedMode})` : ""}
            </span>
            {scan.preflight.notes.map((n) => (
              <span key={n}>· {n}</span>
            ))}
            {scan.preflight.warnings.map((n) => (
              <span key={n} className="text-signal-blocked">
                · {n}
              </span>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-signal-error">{error}</p>}
      </section>

      {scan && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-8">
          <button
            onClick={() => setFilter(filter === "hits" ? "all" : "hits")}
            className={`rounded-lg border px-3 py-2 text-left ${
              filter === "hits" ? "border-accent bg-ink-800" : "border-ink-600 bg-ink-900/70"
            }`}
          >
            <div className="font-mono text-[10px] uppercase text-fog-500">hits</div>
            <div className="font-mono text-xl text-fog-100">{hitCount}</div>
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? "all" : s)}
              className={`rounded-lg border px-3 py-2 text-left ${
                filter === s ? "border-accent bg-ink-800" : "border-ink-600 bg-ink-900/70"
              }`}
            >
              <div className="font-mono text-[10px] uppercase text-fog-500">{s}</div>
              <div className={`font-mono text-xl ${STATUS_COLOR[s]}`}>{progress?.[s] ?? 0}</div>
            </button>
          ))}
          <button
            onClick={() => setFilter("all")}
            className={`rounded-lg border px-3 py-2 text-left ${
              filter === "all" ? "border-accent bg-ink-800" : "border-ink-600 bg-ink-900/70"
            }`}
          >
            <div className="font-mono text-[10px] uppercase text-fog-500">all</div>
            <div className="font-mono text-xl text-fog-100">{progress?.done ?? 0}</div>
          </button>
        </div>
      )}

      {scan && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-ink-700">
          <div
            className="h-full bg-accent transition-all"
            style={{
              width: `${progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%`,
            }}
          />
        </div>
      )}

      {scan && isMail(scan.dossier) && (
        <MailCards dossier={scan.dossier} onPivot={pivotHandle} onHost={(h) => pivotTo(h, "host")} />
      )}
      {scan && isHost(scan.dossier) && <HostCards dossier={scan.dossier} />}
      {scan && isPhone(scan.dossier) && <PhoneCards dossier={scan.dossier} />}
      <GraphPanel graph={graph} onPivot={pivotTo} />
      <ComparePanel compare={compare} onClose={() => setCompare(null)} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-ink-600 bg-ink-900/70">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-600 px-3 py-2">
            <Activity className="h-4 w-4 text-accent" />
            <span className="text-sm">Ledger</span>
            <span className="font-mono text-[11px] text-fog-500">
              {visible.length}/{rows.length}
              {progress ? ` · ${progress.done}/${progress.total}` : ""}
              {filter === "found" ? " · found first" : filter !== "all" ? ` · ${filter}` : " · all"}
            </span>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="site, url, reason, name"
              className="tap-lg h-11 min-w-[10rem] flex-1 md:ml-auto md:max-w-xs"
            />
            {scan && (
              <div className="flex flex-wrap gap-1">
                {(["md", "json", "jsonl", "csv", "html"] as const).map((fmt) => (
                  <a key={fmt} href={`/api/scans/${scan.id}/export?format=${fmt}`}>
                    <Button type="button" variant="outline" size="sm">
                      <Download className="h-3 w-3" />
                      {fmt.toUpperCase()}
                    </Button>
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto border-b border-ink-600 px-3 py-2">
            <Chip active={category === "all"} onClick={() => setCategory("all")}>
              all
            </Chip>
            {cats.map(([c, n]) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c} {n}
              </Chip>
            ))}
          </div>
          <div className="max-h-[62vh] overflow-auto">
            {visible.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-fog-500">
                {rows.length === 0
                  ? busy
                    ? "Waiting for the first classified row…"
                    : "Run a handle, mail, host, or phone recon to fill the ledger."
                  : filter === "found"
                    ? "Found first — no hits yet. Miss/blocked stay out of this view. Tap All or Hits."
                    : "No rows match this filter."}
              </p>
            )}
            {visible.map((row) => (
              <button
                key={row.id}
                onClick={() => openRow(row)}
                className={`ledger-row flex w-full items-start gap-3 border-b border-ink-700 px-3 py-2 text-left ${
                  selected?.id === row.id ? "bg-accent/10" : ""
                }`}
              >
                {row.metadata?.avatarUrl ? (
                  <img
                    src={row.metadata.avatarUrl}
                    alt=""
                    className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-ink-600 object-cover"
                  />
                ) : (
                  <Badge tone={row.status}>{row.status}</Badge>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">{row.site}</span>
                    {row.metadata?.avatarUrl && <Badge tone={row.status}>{row.status}</Badge>}
                    <span className="font-mono text-[10px] text-fog-500">{row.category}</span>
                    {row.metadata?.displayName && (
                      <span className="hidden truncate text-xs text-fog-300 sm:inline">
                        {row.metadata.displayName}
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-fog-500">{row.profileUrl || row.url}</div>
                  <div className="truncate text-[11px] text-fog-500">{row.reason}</div>
                </div>
                <span className="hidden shrink-0 font-mono text-[10px] text-fog-500 md:inline">
                  {row.httpStatus ?? "—"} · {row.latencyMs ?? "—"}ms
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="hidden rounded-xl border border-ink-600 bg-ink-900/70 p-4 lg:block">
          <h2 className="mb-3 text-sm text-fog-300">Inspector</h2>
          <Inspector selected={selected} />
        </aside>
      </div>

      {inspectorOpen && selected && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Close inspector"
            onClick={() => setInspectorOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-auto rounded-t-2xl border border-ink-600 bg-ink-900 p-4 shadow-panel">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm text-fog-300">Inspector</h2>
              <button
                onClick={() => setInspectorOpen(false)}
                className="rounded-md border border-ink-600 p-1 text-fog-300"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Inspector selected={selected} />
          </div>
        </div>
      )}
    </div>
  );
}

function Inspector({ selected }: { selected: LedgerRow | null }) {
  if (!selected) return <p className="text-sm text-fog-500">Select a ledger row.</p>;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge tone={selected.status}>{selected.status}</Badge>
        <span className="font-medium">{selected.site}</span>
        <span className="font-mono text-[10px] text-fog-500">{selected.category}</span>
      </div>
      <div className="rounded-lg border border-ink-600 bg-ink-950 p-3 text-xs text-fog-300">
        <div className="mb-1 font-mono text-[10px] uppercase text-fog-500">Why {selected.status}</div>
        {STATUS_WHY[selected.status]}
      </div>
      <Field label="Reason" value={selected.reason} />
      <Field label="URL" value={selected.url} href={selected.url} />
      {selected.profileUrl && <Field label="Profile" value={selected.profileUrl} href={selected.profileUrl} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="HTTP" value={String(selected.httpStatus ?? "n/a")} />
        <Field label="Method" value={selected.method} />
      </div>
      {selected.finalUrl && selected.finalUrl !== selected.url && (
        <Field label="Final URL" value={selected.finalUrl} href={selected.finalUrl} />
      )}
      {selected.protection?.length ? <Field label="Protection" value={selected.protection.join(", ")} /> : null}
      <Field label="Via" value={selected.via ?? "undici"} />
      {selected.phash && <Field label="Avatar pHash" value={selected.phash} />}
      {selected.latencyMs != null && <Field label="Latency" value={`${selected.latencyMs} ms`} />}
      {selected.metadata && (
        <div className="rounded-lg border border-ink-600 bg-ink-950 p-3">
          <div className="mb-2 flex items-center gap-3">
            {selected.metadata.avatarUrl && (
              <img
                src={selected.metadata.avatarUrl}
                alt=""
                className="h-12 w-12 rounded-full border border-ink-600 object-cover"
              />
            )}
            <div>
              <div className="font-medium">{selected.metadata.displayName || selected.site}</div>
              {selected.metadata.location && (
                <div className="text-xs text-fog-500">{selected.metadata.location}</div>
              )}
              {selected.metadata.website && (
                <a
                  className="break-all text-xs text-accent hover:underline"
                  href={selected.metadata.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.metadata.website}
                </a>
              )}
            </div>
          </div>
          {selected.metadata.bio && <p className="text-xs text-fog-300">{selected.metadata.bio}</p>}
          <div className="mt-2 flex gap-3 font-mono text-[11px] text-fog-500">
            {selected.metadata.followers != null && <span>{selected.metadata.followers} followers</span>}
            {selected.metadata.following != null && <span>{selected.metadata.following} following</span>}
          </div>
          {selected.metadata.extra && (
            <dl className="mt-2 space-y-1 font-mono text-[11px] text-fog-500">
              {Object.entries(selected.metadata.extra).map(([k, v]) =>
                v === "" || v == null ? null : (
                  <div key={k} className="flex justify-between gap-3">
                    <dt>{k}</dt>
                    <dd className="truncate text-fog-300">{String(v)}</dd>
                  </div>
                ),
              )}
            </dl>
          )}
        </div>
      )}
      {selected.bodyExcerpt && (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase text-fog-500">Body excerpt</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 font-mono text-[11px] text-fog-300">
            {selected.bodyExcerpt}
          </pre>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap-lg shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase ${
        active ? "border-accent text-fog-100" : "border-ink-600 text-fog-500"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase text-fog-500">{label}</div>
      {href && href.startsWith("http") ? (
        <a className="break-all text-accent hover:underline" href={href} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <div className="break-all text-fog-100">{value}</div>
      )}
    </div>
  );
}

function MailCards({
  dossier,
  onPivot,
  onHost,
}: {
  dossier: MailDossier;
  onPivot: (handle: string) => void;
  onHost: (host: string) => void;
}) {
  const pivots = dossier.pivots.length ? dossier.pivots : [dossier.localPartAnalysis.base];
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card icon={<Mail className="h-4 w-4" />} title="Identity">
        <p className="font-mono text-sm">{dossier.email}</p>
        <p className="mt-1 text-xs text-fog-500">
          {dossier.providerGuess ?? "unknown provider"}
          {dossier.roleBased ? " · role-based" : ""}
          {dossier.plusAddress ? " · plus-address" : ""}
          {dossier.disposable ? " · disposable" : ""}
        </p>
        <p className="mt-2 text-xs text-fog-300">
          Patterns: {dossier.localPartAnalysis.patterns.join(", ") || "none"}
          {dossier.localPartAnalysis.possibleNames.length
            ? ` · ${dossier.localPartAnalysis.possibleNames.join(", ")}`
            : ""}
        </p>
        {dossier.tenant?.namespace && (
          <p className="mt-2 font-mono text-[11px] text-fog-300">
            M365 {dossier.tenant.namespace}
            {dossier.tenant.federationBrand ? ` · ${dossier.tenant.federationBrand}` : ""}
          </p>
        )}
        {dossier.domainCreated && (
          <p className="font-mono text-[11px] text-fog-500">domain created {dossier.domainCreated}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {pivots.slice(0, 6).map((p) => (
            <Button key={p} size="sm" variant="outline" className="tap-lg" onClick={() => onPivot(p)}>
              <UserRound className="h-3.5 w-3.5" />
              {p}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="tap-lg" onClick={() => onHost(dossier.domain)}>
            <Globe className="h-3.5 w-3.5" />
            {dossier.domain}
          </Button>
        </div>
      </Card>
      <Card icon={<Globe className="h-4 w-4" />} title="MX / auth">
        {dossier.mx.length === 0 && <p className="text-sm text-fog-500">No MX records</p>}
        {dossier.mx.slice(0, 3).map((m) => (
          <p key={m.exchange} className="font-mono text-xs">
            {m.priority} {m.exchange}
          </p>
        ))}
        <p className="mt-2 break-all font-mono text-[11px] text-fog-500">
          {dossier.domainSpf[0]?.raw ?? "no SPF"}
        </p>
        <p className="mt-1 break-all font-mono text-[11px] text-fog-500">
          {dossier.domainDmarc[0]?.raw ?? "no DMARC"}
        </p>
        <p className="mt-2 font-mono text-[11px] text-fog-300">
          DKIM {dossier.dkim.length ? dossier.dkim.map((d) => d.selector).join(", ") : "none"}
        </p>
        <p className="font-mono text-[11px] text-fog-500">
          BIMI {dossier.bimi?.present ? "present" : "absent"}
        </p>
      </Card>
      <Card icon={<Fingerprint className="h-4 w-4" />} title="Gravatar">
        {dossier.gravatar?.exists ? (
          <div className="flex gap-3">
            {dossier.gravatar.avatarUrl && (
              <img src={dossier.gravatar.avatarUrl} alt="" className="h-12 w-12 rounded-full" />
            )}
            <div>
              <p>{dossier.gravatar.displayName ?? "Profile present"}</p>
              <p className="font-mono text-[11px] text-fog-500">md5 {dossier.gravatar.hash}</p>
              {dossier.gravatar.sha256 && (
                <p className="truncate font-mono text-[11px] text-fog-500">sha256 {dossier.gravatar.sha256}</p>
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-fog-500">No public Gravatar profile</p>
            <p className="mt-1 font-mono text-[11px] text-fog-500">md5 {dossier.gravatar?.hash}</p>
            {dossier.gravatar?.sha256 && (
              <p className="truncate font-mono text-[11px] text-fog-500">sha256 {dossier.gravatar.sha256}</p>
            )}
          </div>
        )}
      </Card>
      <Card icon={<UserRound className="h-4 w-4" />} title="Pivots">
        {pivots.length === 0 && <p className="text-sm text-fog-500">No handle pivots</p>}
        <ul className="max-h-36 space-y-1 overflow-auto font-mono text-xs text-fog-300">
          {pivots.map((p) => (
            <li key={p}>
              <button className="text-accent hover:underline" onClick={() => onPivot(p)}>
                {p}
              </button>
            </li>
          ))}
        </ul>
        {dossier.gravatar?.accounts?.length ? (
          <p className="mt-2 text-[11px] text-fog-500">
            Gravatar linked: {dossier.gravatar.accounts.map((a) => a.shortname).join(", ")}
          </p>
        ) : null}
        {dossier.openLinks?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {dossier.openLinks.map((l) => (
              <a
                key={l.label}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-ink-600 px-1.5 py-0.5 font-mono text-[10px] uppercase text-fog-300 hover:border-accent hover:text-fog-100"
              >
                <ExternalLink className="h-3 w-3" />
                {l.label}
              </a>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function PhoneCards({ dossier }: { dossier: PhoneDossier }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card icon={<Phone className="h-4 w-4" />} title="E.164">
        <p className="font-mono text-sm">{dossier.e164 ?? dossier.raw}</p>
        <p className="mt-1 text-xs text-fog-500">
          {dossier.valid ? "valid" : dossier.possible ? "possible" : "invalid"}
          {dossier.internationalFormat ? ` · ${dossier.internationalFormat}` : ""}
        </p>
        {dossier.nationalFormat && <p className="font-mono text-[11px] text-fog-500">{dossier.nationalFormat}</p>}
      </Card>
      <Card icon={<Globe className="h-4 w-4" />} title="Region / type">
        <p className="text-sm">{dossier.regionHint ?? dossier.country ?? "unknown region"}</p>
        <p className="mt-1 font-mono text-[11px] text-fog-500">
          {dossier.type ?? "type unknown"}
          {dossier.countryCallingCode ? ` · +${dossier.countryCallingCode}` : ""}
        </p>
      </Card>
      <Card icon={<Fingerprint className="h-4 w-4" />} title="Carrier hint">
        <p className="text-sm">{dossier.carrierHint ?? "No live carrier lookup"}</p>
        {dossier.lookups.map((l) => (
          <p key={l.source} className="mt-1 font-mono text-[11px] text-fog-500">
            {l.source}: {l.detail ?? l.status}
          </p>
        ))}
      </Card>
      <Card icon={<Share2 className="h-4 w-4" />} title="Public links">
        {dossier.e164 && (
          <a
            className="text-sm text-accent hover:underline"
            href={`https://duckduckgo.com/?q=${encodeURIComponent(`"${dossier.e164}"`)}`}
            target="_blank"
            rel="noreferrer"
          >
            DuckDuckGo “{dossier.e164}”
          </a>
        )}
        <p className="mt-2 text-[11px] text-fog-500">No SMS. Optional Twilio/Numverify keys add carrier names.</p>
      </Card>
    </div>
  );
}

function HostCards({ dossier }: { dossier: HostDossier }) {
  const txtOther = dossier.dns.txt.filter((t) => !/^v=spf1/i.test(t) && !/^v=dmarc1/i.test(t)).slice(0, 3);
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card icon={<Globe className="h-4 w-4" />} title="RDAP">
        <p className="text-sm">{dossier.rdap?.registrar ?? "No registrar"}</p>
        <p className="mt-1 font-mono text-[11px] text-fog-500">
          {dossier.rdap?.created ? `created ${dossier.rdap.created}` : "no creation date"}
        </p>
        {dossier.rdap?.expires && (
          <p className="font-mono text-[11px] text-fog-500">expires {dossier.rdap.expires}</p>
        )}
        {dossier.rdap?.updated && (
          <p className="font-mono text-[11px] text-fog-500">updated {dossier.rdap.updated}</p>
        )}
        <p className="font-mono text-[11px] text-fog-500">
          {dossier.rdap?.status?.slice(0, 3).join(", ") || "no status"}
        </p>
        {dossier.rdap?.nameservers?.length ? (
          <p className="mt-1 font-mono text-[11px] text-fog-300">
            NS {dossier.rdap.nameservers.slice(0, 3).join(", ")}
          </p>
        ) : null}
        {dossier.rdap?.abuseEmail && (
          <p className="mt-1 font-mono text-[11px] text-fog-300">{dossier.rdap.abuseEmail}</p>
        )}
        {dossier.rdap?.dnssec != null && (
          <p className="font-mono text-[11px] text-fog-500">
            DNSSEC {dossier.rdap.dnssec ? "signed" : "unsigned"}
          </p>
        )}
      </Card>
      <Card icon={<Activity className="h-4 w-4" />} title="DNS">
        <p className="font-mono text-xs">A {dossier.dns.a.join(", ") || "—"}</p>
        <p className="font-mono text-xs">AAAA {dossier.dns.aaaa.join(", ") || "—"}</p>
        <p className="font-mono text-xs">MX {dossier.dns.mx.map((m) => m.exchange).join(", ") || "—"}</p>
        <p className="font-mono text-xs">NS {dossier.dns.ns.slice(0, 3).join(", ") || "—"}</p>
        {dossier.dns.soa && <p className="font-mono text-[11px] text-fog-500">SOA {dossier.dns.soa}</p>}
        {dossier.dns.caa.length > 0 && (
          <p className="font-mono text-[11px] text-fog-500">CAA {dossier.dns.caa.slice(0, 2).join("; ")}</p>
        )}
        {txtOther.map((t) => (
          <p key={t} className="truncate font-mono text-[11px] text-fog-500">
            TXT {t}
          </p>
        ))}
        <p className="mt-1 font-mono text-[11px] text-fog-300">
          DKIM {dossier.dkim.length ? dossier.dkim.map((d) => d.selector).join(", ") : "none"}
          {dossier.bimi?.present ? " · BIMI" : ""}
        </p>
      </Card>
      <Card icon={<ShieldAlert className="h-4 w-4" />} title="SPF / DMARC / security.txt">
        <p className="break-all font-mono text-[11px]">{dossier.spf[0]?.raw ?? "no SPF"}</p>
        <p className="mt-2 break-all font-mono text-[11px]">{dossier.dmarc[0]?.raw ?? "no DMARC"}</p>
        <p className="mt-2 text-xs text-fog-300">
          security.txt {dossier.securityTxt?.found ? "present" : "absent"}
        </p>
        {dossier.securityTxt?.contact?.slice(0, 2).map((c) => (
          <p key={c} className="truncate font-mono text-[11px] text-fog-500">
            {c}
          </p>
        ))}
        {dossier.securityTxt?.expires && (
          <p className="font-mono text-[11px] text-fog-500">expires {dossier.securityTxt.expires}</p>
        )}
      </Card>
      <Card icon={<Fingerprint className="h-4 w-4" />} title="HTTPS / cert">
        <p className="text-sm">{dossier.https?.title ?? "no title"}</p>
        <p className="mt-1 font-mono text-[11px] text-fog-500">
          {dossier.https?.status} {dossier.https?.server} {dossier.https?.hsts ? "HSTS" : ""}{" "}
          {dossier.https?.csp ? "CSP" : ""}
        </p>
        {dossier.https?.xFrameOptions && (
          <p className="font-mono text-[11px] text-fog-500">XFO {dossier.https.xFrameOptions}</p>
        )}
        {dossier.https?.referrerPolicy && (
          <p className="font-mono text-[11px] text-fog-500">RP {dossier.https.referrerPolicy}</p>
        )}
        {dossier.cert && (
          <div className="mt-2 space-y-1">
            <p className="font-mono text-[11px] text-fog-300">
              {dossier.cert.subject}
              {dossier.cert.daysRemaining != null ? ` · ${dossier.cert.daysRemaining}d` : ""}
            </p>
            <p className="font-mono text-[11px] text-fog-500">issuer {dossier.cert.issuer}</p>
            <div className="flex flex-wrap gap-1">
              {dossier.cert.san.slice(0, 8).map((s) => (
                <span key={s} className="rounded border border-ink-600 px-1.5 py-0.5 font-mono text-[10px] text-fog-300">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-fog-500">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
