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
  Waypoints,
  X,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ComparePanel, GraphPanel } from "@/components/GraphPanel";
import { CasesPanel, openSavedCase } from "@/components/CasesPanel";
import { AlertsPanel } from "@/components/AlertsPanel";
import { BatchPanel } from "@/components/BatchPanel";
import { AvatarClustersPanel } from "@/components/AvatarClustersPanel";
import { ShareView, shareRouteFromLocation } from "@/components/ShareView";
import { VirtualLedger } from "@/components/VirtualLedger";
import { createBatcher, progressPercent, SSE_FLUSH_MS, type ScanProfile } from "@shared/scan-limits";
import type {
  AlertChannelsPublic,
  CrawlDossier,
  HostDossier,
  IdentityGraph,
  LedgerRow,
  LedgerStatus,
  MailDossier,
  PhoneDossier,
  SavedCase,
  ScanCompare,
  ScanEvent,
  ScanMode,
  ScanProgress,
  ScanSummary,
  SchemaStats,
  WatchAlert,
  WatchRecord,
} from "@shared/types";
import { AUTHORIZED_USE } from "@shared/constants";
import { caseFromScan, loadCases, saveCaseHybrid, type CasesPersist } from "@/lib/cases";

const STATUSES: LedgerStatus[] = ["found", "miss", "blocked", "escalate", "error", "invalid"];

const STATUS_RANK: Record<LedgerStatus, number> = {
  found: 0,
  blocked: 1,
  escalate: 2,
  miss: 3,
  error: 4,
  invalid: 5,
};

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
  return Boolean(d && "dns" in d && "domain" in d);
}
function isPhone(d: ScanSummary["dossier"]): d is PhoneDossier {
  return Boolean(d && "e164" in d);
}
function isCrawl(d: ScanSummary["dossier"]): d is CrawlDossier {
  return Boolean(d && "kind" in d && d.kind === "crawl");
}

export default function App() {
  const [accepted, setAccepted] = useState(() => localStorage.getItem("umbra.ok") === "1");
  const [query, setQuery] = useState("octocat");
  const [mode, setMode] = useState<ScanMode>("auto");
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [profile, setProfile] = useState<ScanProfile>("lean");
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("found");
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [schema, setSchema] = useState<SchemaStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState<IdentityGraph | null>(null);
  const [cases, setCases] = useState<SavedCase[]>([]);
  const [casesPersist, setCasesPersist] = useState<CasesPersist>("local");
  const [watches, setWatches] = useState<WatchRecord[]>([]);
  const [alerts, setAlerts] = useState<WatchAlert[]>([]);
  const [watchPersist, setWatchPersist] = useState<"volume" | "memory">("memory");
  const [watchWebhook, setWatchWebhook] = useState(false);
  const [alertChannels, setAlertChannels] = useState<AlertChannelsPublic | null>(null);
  const [powerOn, setPowerOn] = useState(false);
  const [powerMeta, setPowerMeta] = useState<{
    enabled?: boolean;
    allowed?: boolean;
    ramMb?: number;
    ramAllowsPower?: boolean;
    note?: string;
  } | null>(null);
  const [powerNote, setPowerNote] = useState<string | null>(null);
  const [compare, setCompare] = useState<ScanCompare | null>(null);
  const [installEvent, setInstallEvent] = useState<{ prompt: () => Promise<unknown> } | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const batcherRef = useRef<ReturnType<typeof createBatcher<LedgerRow>> | null>(null);
  const rowsRef = useRef<LedgerRow[]>([]);
  const scanRef = useRef<ScanSummary | null>(null);
  const graphRef = useRef<IdentityGraph | null>(null);
  const pivotQueueRef = useRef<{ query: string; mode: ScanMode }[]>([]);

  rowsRef.current = rows;
  scanRef.current = scan;
  graphRef.current = graph;

  const refreshWatches = () => {
    void fetch("/api/watches")
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as {
              persist?: "volume" | "memory";
              watches?: WatchRecord[];
              alerts?: WatchAlert[];
              channels?: AlertChannelsPublic;
            })
          : null,
      )
      .then((data) => {
        if (!data) return;
        if (data.persist) setWatchPersist(data.persist);
        setWatches(data.watches ?? []);
        setAlerts(data.alerts ?? []);
        if (data.channels) setAlertChannels(data.channels);
      })
      .catch(() => undefined);
    void fetch("/api/health")
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as {
              watches?: { webhook?: boolean; channels?: AlertChannelsPublic };
              power?: { enabled?: boolean; allowed?: boolean; ramMb?: number; ramAllowsPower?: boolean; note?: string };
            })
          : null,
      )
      .then((h) => {
        if (h?.watches?.webhook != null) setWatchWebhook(h.watches.webhook);
        if (h?.watches?.channels) setAlertChannels(h.watches.channels);
        if (h?.power) {
          setPowerMeta(h.power);
          if (h.power.note) setPowerNote(h.power.note);
          if (h.power.enabled) setPowerOn(true);
        }
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    void fetch("/api/schema")
      .then(async (r) => {
        if (!r.ok) return null;
        try {
          return (await r.json()) as SchemaStats;
        } catch {
          return null;
        }
      })
      .then(setSchema)
      .catch(() => setSchema(null));
    void fetch("/api/health")
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as {
              limits?: { profile?: ScanProfile; power?: boolean };
              power?: { enabled?: boolean; allowed?: boolean; ramMb?: number; note?: string };
              watches?: { webhook?: boolean; channels?: AlertChannelsPublic };
            })
          : null,
      )
      .then((h) => {
        if (h?.limits?.profile === "full" || h?.limits?.profile === "lean") setProfile(h.limits.profile);
        if (h?.power?.note) setPowerNote(h.power.note);
        if (h?.power) {
          setPowerMeta(h.power);
          if (h.power.enabled) setPowerOn(true);
        }
        if (h?.watches?.webhook != null) setWatchWebhook(h.watches.webhook);
        if (h?.watches?.channels) setAlertChannels(h.watches.channels);
      })
      .catch(() => undefined);
    void loadCases()
      .then((loaded) => {
        setCasesPersist(loaded.persist);
        setCases(loaded.cases);
      })
      .catch(() => undefined);
    void refreshWatches();
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
      batcherRef.current?.flush();
    },
    [],
  );

  const applyRows = (batch: LedgerRow[]) => {
    if (!batch.length) return;
    setRows((prev) => prev.concat(batch));
    setSelected((cur) => cur ?? batch.find((r) => r.status === "found") ?? batch[0]);
  };

  const queueRows = (incoming: LedgerRow | LedgerRow[]) => {
    if (!batcherRef.current) batcherRef.current = createBatcher(applyRows, SSE_FLUSH_MS);
    const list = Array.isArray(incoming) ? incoming : [incoming];
    const hits = list.filter((r) => r.status === "found");
    const rest = list.filter((r) => r.status !== "found");
    if (hits.length) applyRows(hits);
    if (rest.length) batcherRef.current.pushMany(rest);
  };

  const persistActive = async (summary?: ScanSummary | null) => {
    const s = summary ?? scanRef.current;
    if (!s) return;
    batcherRef.current?.flush();
    const rec = caseFromScan(s, rowsRef.current, graphRef.current ?? s.graph);
    const saved = await saveCaseHybrid(rec, casesPersist, s.id);
    setCases((prev) => [saved, ...prev.filter((c) => c.id !== saved.id)].slice(0, 24));
  };

  const start = async (override?: { query?: string; mode?: ScanMode; keepPivots?: boolean }) => {
    const q = (override?.query ?? query).trim();
    if (!q) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    setRows([]);
    batcherRef.current = createBatcher(applyRows, SSE_FLUSH_MS);
    setSelected(null);
    setInspectorOpen(false);
    setFilter("found");
    setCategory("all");
    setSearch("");
    setGraph(null);
    setCompare(null);
    if (!override?.keepPivots) pivotQueueRef.current = [];
    sourceRef.current?.close();
    try {
      const payload = {
        query: q,
        mode: override?.mode ?? mode,
        includeNsfw,
        replace: true,
        profile,
        power: powerOn,
      };
      let res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // One auto-retry on conflict / busy — cancel-replace should make this rare.
      if (res.status === 409 || res.status === 429) {
        res = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, replace: true }),
        });
      }
      const data = (await res.json()) as ScanSummary & { error?: string };
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setScan(data);
      if (data.profileNote) setNotice(data.profileNote);
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
        if (event.type === "row") queueRows(event.row);
        if (event.type === "rows") queueRows(event.rows);
        if (event.type === "notice") setNotice(event.message);
        if (event.type === "dossier" || event.type === "done") {
          if (event.type === "done") batcherRef.current?.flush();
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
          void persistActive(event.scan).then(() => {
            const next = pivotQueueRef.current.shift();
            if (next) {
              setNotice(`Auto-pivot: ${next.mode} ${next.query}`);
              void start({ query: next.query, mode: next.mode, keepPivots: true });
            }
          });
        }
      };
      es.onerror = () => {
        batcherRef.current?.flush();
        setBusy(false);
        es.close();
      };
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };


  const cancel = async () => {
    pivotQueueRef.current = [];
    sourceRef.current?.close();
    batcherRef.current?.flush();
    setBusy(false);
    setScan((s) => (s && s.status === "running" ? { ...s, status: "cancelled", abortReason: "cancelled by user" } : s));
    const id = scanRef.current?.id ?? scan?.id;
    if (!id) return;
    try {
      const res = await fetch(`/api/scans/${id}/cancel`, { method: "POST" });
      const data = (await res.json()) as { error?: string; scan?: ScanSummary };
      if (!res.ok) throw new Error(data.error || "Cancel failed");
      if (data.scan) setScan(data.scan);
    } catch (err) {
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
    void persistActive();
  };

  const runPivots = () => {
    const s = scan;
    if (!s) return;
    void persistActive(s);
    if (isMail(s.dossier)) {
      const d = s.dossier;
      const handle = d.localPartAnalysis.base || d.localPart;
      pivotQueueRef.current = [
        { query: handle, mode: "handle" },
        { query: d.domain, mode: "host" },
      ];
      const first = pivotQueueRef.current.shift();
      if (first) {
        setQuery(first.query);
        setMode(first.mode);
        setNotice(`Pivoting ${first.mode} ${first.query}, then host ${d.domain}`);
        void start({ query: first.query, mode: first.mode, keepPivots: true });
      }
      return;
    }
    if (isCrawl(s.dossier)) {
      const d = s.dossier;
      pivotQueueRef.current = [
        ...d.usernames.slice(0, 2).map((u) => ({ query: u, mode: "handle" as const })),
        ...d.emails.slice(0, 1).map((e) => ({ query: e, mode: "mail" as const })),
        { query: d.host, mode: "host" },
      ];
      const first = pivotQueueRef.current.shift();
      if (first) {
        setQuery(first.query);
        setMode(first.mode);
        setNotice(`Crawl pivots: ${first.mode} ${first.query}`);
        void start({ query: first.query, mode: first.mode, keepPivots: true });
      }
    }
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
  const pct = progressPercent(progress?.done ?? 0, progress?.total ?? 0);
  const hitCount = (progress?.found ?? 0) + (progress?.blocked ?? 0) + (progress?.escalate ?? 0);
  const likelyHits = useMemo(
    () =>
      rows
        .filter((r) => r.status === "found" && r.category !== "dns")
        .slice(0, 16),
    [rows],
  );

  const openRow = (row: LedgerRow) => {
    setSelected(row);
    setInspectorOpen(true);
  };

  const shareRoute = shareRouteFromLocation();
  if (shareRoute) {
    return <ShareView token={shareRoute.token} caseId={shareRoute.caseId} />;
  }

  if (!accepted) {
    return (
      <div
        className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-fog-100"
        style={{ background: "#07080c", color: "#e8e6e1" }}
      >
        <div className="rounded-2xl border border-ink-600 bg-ink-900 p-6 shadow-panel">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Umbra</p>
          <h1 className="mt-3 text-3xl font-medium text-white">Authorized use only</h1>
          <p className="mt-4 text-fog-100">{AUTHORIZED_USE}</p>
          <p className="mt-3 text-sm text-fog-300">
            Handle, mail, host, phone, and crawl modules query public endpoints. Private/loopback fetches are blocked.
            Silent mail oracles never SMTP the subject. Phone mode never sends SMS.
          </p>
          <Button
            className="mt-8 w-fit bg-accent text-white"
            onClick={() => {
              localStorage.setItem("umbra.ok", "1");
              setAccepted(true);
            }}
          >
            I am authorized — open the ledger
          </Button>
        </div>
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
            <p className="mt-1 max-w-2xl text-xs text-fog-300">
              {schema
                ? `${schema.handleSites} handle sites · lean ${schema.leanSites ?? 200} · ${schema.oracles} mail oracles${schema.oraclesLean ? ` · lean ${schema.oraclesLean}` : ""} · ${schema.disposableDomains} disposable domains${schema.sherlockSites ? ` · ${schema.sherlockSites} Sherlock overlay` : ""}`
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
          {scan && isMail(scan.dossier) && (
            <Button size="sm" variant="outline" className="tap-lg" onClick={runPivots}>
              <Waypoints className="h-3.5 w-3.5" />
              Run pivots
            </Button>
          )}
          {scan && isCrawl(scan.dossier) && (
            <Button size="sm" variant="outline" className="tap-lg" onClick={runPivots}>
              <Waypoints className="h-3.5 w-3.5" />
              Run pivots
            </Button>
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
              ["crawl", "Crawl"],
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(
            [
              ["lean", "Lean"],
              ["full", "Full"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProfile(id)}
              className={`tap-lg rounded-full border px-4 py-2 font-mono text-xs uppercase tracking-wide ${
                profile === id
                  ? "border-accent bg-accent/15 text-fog-100"
                  : "border-ink-600 text-fog-500 hover:border-fog-500"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (powerOn) {
                setPowerOn(false);
                return;
              }
              const leanBox = !powerMeta?.allowed && !powerMeta?.ramAllowsPower;
              if (leanBox) {
                const ok = window.confirm(
                  "Power enables TLS impersonation (curl children) and 8 workers. On a 1 GB Railway plan this can OOM the cgroup. Raise memory to ≥2 GB in Settings → Resources first. Continue anyway?",
                );
                if (!ok) return;
              }
              setPowerOn(true);
              setProfile("full");
            }}
            className={`tap-lg rounded-full border px-4 py-2 font-mono text-xs uppercase tracking-wide ${
              powerOn ? "border-signal-blocked bg-signal-blocked/15 text-fog-100" : "border-ink-600 text-fog-500 hover:border-fog-500"
            }`}
          >
            Power
          </button>
          <span className="font-mono text-[11px] text-fog-300">
            {powerOn
              ? "Power: Full map allowed + curl-impersonate (UMBRA_CURL_MAX≥1). Playwright stays off unless UMBRA_PLAYWRIGHT=1."
              : profile === "lean"
                ? `Lean: ~${schema?.leanSites ?? 200} handle sites · crawl 25 pages · high-signal mail first (fits 1 GB Railway).`
                : "Full: all clearnet sites + remaining mail oracles. TLS children stay off on 1 GB unless Power is on."}
          </span>
          {!powerOn && powerNote && <span className="font-mono text-[11px] text-fog-500">{powerNote}</span>}
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
              placeholder="octocat · press@github.com · github.com · https://example.com · +14155552671"
              className="tap-lg pl-9"
              autoFocus
              inputMode={mode === "phone" ? "tel" : "text"}
            />
          </div>
          <Button type="submit" size="lg" className="tap-lg w-full sm:w-auto">
            {busy ? "Replace…" : "Recon"}
          </Button>
          {(busy || scan?.status === "running") && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="tap-lg w-full sm:w-auto border-signal-blocked text-signal-blocked"
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          )}
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
        {notice && <p className="mt-2 text-sm text-fog-300">{notice}</p>}
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
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded bg-ink-700">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs text-fog-100">
            {pct}%{progress ? ` · ${progress.done}/${progress.total}` : ""}
            {scan.status === "running" ? " · live" : scan.status === "cancelled" ? " · cancelled" : ""}
          </span>
        </div>
      )}

      {likelyHits.length > 0 && (
        <div className="mt-3 rounded-xl border border-signal-found/30 bg-signal-found/5 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-signal-found">
            Likely hits{scan?.status === "running" ? " · still scanning" : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {likelyHits.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openRow(r)}
                className="tap-lg rounded-full border border-signal-found/40 bg-ink-950 px-3 py-1 font-mono text-[11px] text-signal-found"
              >
                {r.site}
              </button>
            ))}
          </div>
        </div>
      )}

      {scan && isMail(scan.dossier) && (
        <MailCards
          dossier={scan.dossier}
          onPivot={pivotHandle}
          onHost={(h) => pivotTo(h, "host")}
          onRunPivots={runPivots}
        />
      )}
      {scan && isHost(scan.dossier) && <HostCards dossier={scan.dossier} />}
      {scan && isPhone(scan.dossier) && <PhoneCards dossier={scan.dossier} />}
      {scan && isCrawl(scan.dossier) && (
        <CrawlCards dossier={scan.dossier} onPivot={pivotTo} onRunPivots={runPivots} />
      )}
      <AvatarClustersPanel clusters={scan?.avatarClusters} />
      <GraphPanel
        graph={graph}
        onPivot={pivotTo}
        onRunPivots={scan && (isMail(scan.dossier) || isCrawl(scan.dossier)) ? runPivots : undefined}
      />
      <ComparePanel compare={compare} onClose={() => setCompare(null)} />
      <CasesPanel
        cases={cases}
        persist={casesPersist}
        onChange={setCases}
        onOpen={(rec) => {
          const opened = openSavedCase(rec);
          sourceRef.current?.close();
          setBusy(false);
          setScan(opened.scan);
          setRows(opened.rows);
          setGraph(opened.graph);
          setSelected(opened.rows.find((r) => r.status === "found") ?? opened.rows[0] ?? null);
          setFilter("found");
          setNotice(`Opened saved case ${rec.mode} ${rec.query} (${rec.found} found) — no re-scan.`);
        }}
        onCompare={setCompare}
      />
      <BatchPanel />
      <AlertsPanel
        watches={watches}
        alerts={alerts}
        persist={watchPersist}
        webhook={watchWebhook}
        channels={alertChannels ?? undefined}
        defaultQuery={scan?.query}
        defaultMode={scan?.mode}
        onRefresh={refreshWatches}
      />

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
          <VirtualLedger
            items={visible}
            selectedId={selected?.id}
            onOpen={openRow}
            empty={
              <p className="px-4 py-10 text-center text-sm text-fog-500">
                {rows.length === 0
                  ? busy
                    ? "Waiting for the first classified row…"
                    : "Run a handle, mail, host, phone, or crawl recon to fill the ledger."
                  : filter === "found"
                    ? "Found first — no hits yet. Miss/blocked stay out of this view. Tap All or Hits."
                    : "No rows match this filter."}
              </p>
            }
          />
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
  onRunPivots,
}: {
  dossier: MailDossier;
  onPivot: (handle: string) => void;
  onHost: (host: string) => void;
  onRunPivots: () => void;
}) {
  const pivots = dossier.pivots.length ? dossier.pivots : [dossier.localPartAnalysis.base];
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
          <Button size="sm" className="tap-lg" onClick={onRunPivots}>
            <Waypoints className="h-3.5 w-3.5" />
            Run pivots
          </Button>
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
      <Card icon={<Fingerprint className="h-4 w-4" />} title="HIBP">
        {!dossier.hibp?.enabled ? (
          <div>
            <p className="text-sm text-fog-100">Not queried</p>
            <p className="mt-1 text-xs text-fog-300">
              {dossier.hibp?.skipped ?? "Set HIBP_API_KEY to look up breaches. Umbra never emails the subject."}
            </p>
          </div>
        ) : dossier.hibp.skipped ? (
          <p className="text-sm text-signal-blocked">{dossier.hibp.skipped}</p>
        ) : dossier.hibp.breachCount ? (
          <div>
            <p className="text-sm text-signal-found">{dossier.hibp.breachCount} breach record(s)</p>
            <ul className="mt-2 max-h-28 space-y-1 overflow-auto font-mono text-[11px] text-fog-300">
              {dossier.hibp.breaches.slice(0, 12).map((b) => (
                <li key={b.name}>
                  {b.title || b.name}
                  {b.breachDate ? ` · ${b.breachDate}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-fog-100">No breaches reported for this address.</p>
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
        <p className="mt-1 text-xs text-fog-300">
          {dossier.valid ? "valid" : dossier.possible ? "possible" : "invalid"}
          {dossier.internationalFormat ? ` · ${dossier.internationalFormat}` : ""}
        </p>
        {dossier.nationalFormat && <p className="font-mono text-[11px] text-fog-300">{dossier.nationalFormat}</p>}
        {dossier.rfc3966 && <p className="font-mono text-[11px] text-fog-300">{dossier.rfc3966}</p>}
      </Card>
      <Card icon={<Globe className="h-4 w-4" />} title="Region / type">
        <p className="text-sm">{dossier.regionHint ?? dossier.country ?? "unknown region"}</p>
        <p className="mt-1 font-mono text-[11px] text-fog-300">
          {dossier.type ?? "type unknown"}
          {dossier.countryCallingCode ? ` · +${dossier.countryCallingCode}` : ""}
        </p>
        {dossier.timezones.length > 0 && (
          <p className="mt-1 font-mono text-[11px] text-fog-300">{dossier.timezones.join(", ")}</p>
        )}
      </Card>
      <Card icon={<Fingerprint className="h-4 w-4" />} title="Carrier hint">
        <p className="text-sm">{dossier.carrierHint ?? "No live carrier lookup"}</p>
        {dossier.lookups.map((l) => (
          <p key={l.source} className="mt-1 font-mono text-[11px] text-fog-300">
            {l.source}: {l.detail ?? l.status}
          </p>
        ))}
      </Card>
      <Card icon={<Share2 className="h-4 w-4" />} title="Public pivots">
        <div className="flex flex-wrap gap-1.5">
          {(dossier.openLinks ?? []).map((l) => (
            <a
              key={l.label}
              className="inline-flex items-center gap-1 rounded border border-ink-600 px-1.5 py-0.5 font-mono text-[10px] uppercase text-fog-100 hover:border-accent"
              href={l.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-3 w-3" />
              {l.label}
            </a>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-fog-300">No SMS. Optional Twilio/Numverify keys add carrier names.</p>
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

function CrawlCards({
  dossier,
  onPivot,
  onRunPivots,
}: {
  dossier: CrawlDossier;
  onPivot: (q: string, m: ScanMode) => void;
  onRunPivots: () => void;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card icon={<Globe className="h-4 w-4" />} title="Crawl">
        <p className="break-all font-mono text-sm">{dossier.seed}</p>
        <p className="mt-1 text-xs text-fog-300">
          {dossier.pages}/{dossier.maxPages} pages · same-origin {dossier.origin}
        </p>
        <p className="font-mono text-[11px] text-fog-500">
          skipped {dossier.skipped} · SSRF {dossier.blocked}
        </p>
        {dossier.title && <p className="mt-2 text-sm text-fog-100">{dossier.title}</p>}
        <Button size="sm" className="mt-3 tap-lg" onClick={onRunPivots}>
          <Waypoints className="h-3.5 w-3.5" />
          Run pivots
        </Button>
      </Card>
      <Card icon={<Mail className="h-4 w-4" />} title="Emails">
        {dossier.emails.length === 0 && <p className="text-sm text-fog-500">None harvested</p>}
        <ul className="max-h-28 space-y-1 overflow-auto font-mono text-xs text-fog-300">
          {dossier.emails.slice(0, 12).map((e) => (
            <li key={e}>
              <button className="text-accent hover:underline" onClick={() => onPivot(e, "mail")}>
                {e}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card icon={<UserRound className="h-4 w-4" />} title="Usernames">
        {dossier.usernames.length === 0 && <p className="text-sm text-fog-500">None harvested</p>}
        <ul className="max-h-28 space-y-1 overflow-auto font-mono text-xs text-fog-300">
          {dossier.usernames.slice(0, 12).map((u) => (
            <li key={u}>
              <button className="text-accent hover:underline" onClick={() => onPivot(u, "handle")}>
                @{u}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card icon={<ShieldAlert className="h-4 w-4" />} title="Headers">
        {Object.keys(dossier.headers).length === 0 && <p className="text-sm text-fog-500">No security headers</p>}
        {Object.entries(dossier.headers)
          .slice(0, 6)
          .map(([k, v]) => (
            <p key={k} className="truncate font-mono text-[11px] text-fog-300">
              {k}: {v}
            </p>
          ))}
        <Button size="sm" variant="outline" className="mt-3 tap-lg" onClick={() => onPivot(dossier.host, "host")}>
          <Globe className="h-3.5 w-3.5" />
          {dossier.host}
        </Button>
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
