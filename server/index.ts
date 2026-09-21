import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DetectedKind, ScanMode } from "../shared/types.ts";
import { renderExport } from "./exports.ts";
import { healthPayload } from "./health.ts";
import { importWmnPayload, reloadSchema, schemaStats } from "./schema.ts";
import { canStartScan, cancelScan, compareStored, getScan, listScans, startScan, subscribe } from "./scans.ts";
import {
  caseFromScan,
  casesPersistMode,
  compareCases,
  deleteCase,
  exportCase,
  getCase,
  importCasePayload,
  listCases,
  persistCase,
} from "./cases.ts";
import {
  createWatch,
  deleteWatch,
  getWatch,
  listAlerts,
  listWatches,
  markAlertRead,
  runWatch,
  startWatchScheduler,
  watchesPersistMode,
} from "./watches.ts";
import { alertChannels, alertSetup, sendTestAlert } from "./alerts.ts";
import {
  cancelBatch,
  createBatch,
  exportBatch,
  getBatch,
  listBatches,
  runBatch,
} from "./batch.ts";
import {
  createShare,
  listShares,
  publicShareView,
  revokeShare,
  sharePath,
  shareQueryPath,
  sharesPersistMode,
} from "./shares.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || process.env.UMBRA_PORT || 43180);
const HOST = process.env.HOST || "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/api/health", async () => healthPayload());

app.get("/api/schema", async () => schemaStats());

app.post("/api/schema/reload", async () => {
  reloadSchema();
  return schemaStats();
});

app.post("/api/schema/import", async (req, reply) => {
  try {
    const result = importWmnPayload(req.body);
    return { ok: true, ...result, stats: schemaStats() };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/scans", async () => ({ scans: listScans() }));

app.get("/api/scans/compare", async (req, reply) => {
  const q = req.query as { a?: string; b?: string };
  if (!q.a || !q.b) return reply.code(400).send({ error: "a and b scan ids are required" });
  const result = compareStored(q.a, q.b);
  if (!result) return reply.code(404).send({ error: "one or both scans were not found (in-memory)" });
  return result;
});

app.post("/api/scans", async (req, reply) => {
  const body = (req.body ?? {}) as {
    query?: string;
    mode?: ScanMode;
    includeNsfw?: boolean;
    workers?: number;
    perHost?: number;
    replace?: boolean;
    profile?: "lean" | "full";
    power?: boolean;
    autoPivots?: boolean;
    variants?: boolean;
    pivotDepth?: number;
    source?: "user" | "watch" | "batch" | "auto-pivot";
  };
  const replace = body.replace !== false; // default true — interactive UI replaces wedged scans
  const gate = canStartScan({ replace });
  if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
  if (!body.query || !body.query.trim()) {
    return reply.code(400).send({ error: "query is required" });
  }
  const scan = await startScan({
    query: body.query,
    mode: body.mode,
    includeNsfw: body.includeNsfw,
    workers: body.workers,
    perHost: body.perHost,
    replace,
    profile: body.profile,
    power: body.power,
    autoPivots: body.autoPivots,
    variants: body.variants,
    pivotDepth: body.pivotDepth,
    source: body.source,
  });
  return scan;
});

app.post("/api/scans/:id/cancel", async (req, reply) => {
  const { id } = req.params as { id: string };
  const summary = cancelScan(id, "cancelled by user");
  if (!summary) return reply.code(404).send({ error: "scan not found or not running" });
  return { ok: true, scan: summary };
});

app.delete("/api/scans/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const summary = cancelScan(id, "cancelled by user");
  if (!summary) return reply.code(404).send({ error: "scan not found or not running" });
  return { ok: true, scan: summary };
});

app.get("/api/scans/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const stored = getScan(id);
  if (!stored) return reply.code(404).send({ error: "scan not found" });
  return { scan: stored.summary, rows: stored.rows, graph: stored.summary.graph };
});

app.get("/api/scans/:id/graph", async (req, reply) => {
  const { id } = req.params as { id: string };
  const stored = getScan(id);
  if (!stored) return reply.code(404).send({ error: "scan not found" });
  return { graph: stored.summary.graph ?? null, clusters: stored.summary.avatarClusters ?? [] };
});

app.get("/api/scans/:id/events", async (req, reply) => {
  const { id } = req.params as { id: string };
  const stored = getScan(id);
  if (!stored) return reply.code(404).send({ error: "scan not found" });

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsub = subscribe(id, send);
  const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
  req.raw.on("close", () => {
    clearInterval(ping);
    unsub();
  });
});

app.get("/api/scans/:id/export", async (req, reply) => {
  const { id } = req.params as { id: string };
  const format = String((req.query as { format?: string }).format ?? "json");
  const stored = getScan(id);
  if (!stored) return reply.code(404).send({ error: "scan not found" });
  try {
    const file = renderExport(format, stored.summary, stored.rows);
    reply.header("Content-Type", file.contentType);
    reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
    return reply.send(file.body);
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/cases", async () => ({ persist: casesPersistMode(), cases: listCases() }));

app.get("/api/cases/compare", async (req, reply) => {
  const q = req.query as { a?: string; b?: string };
  if (!q.a || !q.b) return reply.code(400).send({ error: "a and b case ids are required" });
  const result = compareCases(q.a, q.b);
  if (!result) return reply.code(404).send({ error: "one or both cases were not found" });
  return result;
});

app.get("/api/cases/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const rec = getCase(id);
  if (!rec) return reply.code(404).send({ error: "case not found" });
  return rec;
});

app.post("/api/cases", async (req, reply) => {
  const body = (req.body ?? {}) as { scanId?: string; case?: unknown };
  if (body.scanId) {
    const stored = getScan(body.scanId);
    if (!stored) return reply.code(404).send({ error: "scan not found" });
    return persistCase(caseFromScan(stored.summary, stored.rows, stored.summary.graph));
  }
  try {
    return importCasePayload(body.case ?? req.body);
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/cases/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!deleteCase(id)) return reply.code(404).send({ error: "case not found" });
  return { ok: true };
});

app.get("/api/cases/:id/export", async (req, reply) => {
  const { id } = req.params as { id: string };
  const format = String((req.query as { format?: string }).format ?? "json");
  const file = exportCase(id, format);
  if (!file) return reply.code(404).send({ error: "case not found" });
  reply.header("Content-Type", file.contentType);
  reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
  return reply.send(file.body);
});

app.get("/api/cases/:id/shares", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!getCase(id)) return reply.code(404).send({ error: "case not found" });
  return { persist: sharesPersistMode(), shares: listShares(id) };
});

app.post("/api/cases/:id/share", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { expiresInHours?: number | null; label?: string };
  try {
    const rec = createShare({
      caseId: id,
      expiresInHours: body.expiresInHours,
      label: body.label,
    });
    return {
      ...rec,
      path: sharePath(rec.token),
      altPath: shareQueryPath(rec.caseId, rec.token),
      readOnly: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return reply.code(msg === "case not found" ? 404 : 400).send({ error: msg });
  }
});

app.get("/api/shares", async () => ({ persist: sharesPersistMode(), shares: listShares() }));

app.post("/api/shares/:token/revoke", async (req, reply) => {
  const { token } = req.params as { token: string };
  const rec = revokeShare(token);
  if (!rec) return reply.code(404).send({ error: "share not found" });
  return rec;
});

app.delete("/api/shares/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const rec = revokeShare(token);
  if (!rec) return reply.code(404).send({ error: "share not found" });
  return rec;
});

app.get("/api/share/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const view = publicShareView(token);
  if (!view) return reply.code(404).send({ error: "share not found, expired, or revoked" });
  return view;
});

app.get("/api/c/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const token = String((req.query as { token?: string }).token ?? "");
  if (!token) return reply.code(400).send({ error: "token is required" });
  const view = publicShareView(token, id);
  if (!view) return reply.code(404).send({ error: "share not found, expired, or revoked" });
  return view;
});

app.get("/api/batch", async () => ({ batches: listBatches() }));

app.post("/api/batch", async (req, reply) => {
  const body = (req.body ?? {}) as { text?: string; lines?: string; profile?: "lean" | "full" };
  const text = body.text ?? body.lines ?? "";
  try {
    const queue = createBatch(text, body.profile === "full" ? "full" : "lean");
    if (queue.status === "queued") void runBatch(queue.id);
    return queue;
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/batch/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const rec = getBatch(id);
  if (!rec) return reply.code(404).send({ error: "batch not found" });
  return rec;
});

app.post("/api/batch/:id/cancel", async (req, reply) => {
  const { id } = req.params as { id: string };
  const rec = cancelBatch(id);
  if (!rec) return reply.code(404).send({ error: "batch not found" });
  return rec;
});

app.get("/api/batch/:id/export", async (req, reply) => {
  const { id } = req.params as { id: string };
  const format = String((req.query as { format?: string }).format ?? "json");
  const file = exportBatch(id, format);
  if (!file) return reply.code(404).send({ error: "batch not found" });
  reply.header("Content-Type", file.contentType);
  reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
  return reply.send(file.body);
});

app.get("/api/watches", async () => ({
  persist: watchesPersistMode(),
  watches: listWatches(),
  alerts: listAlerts(),
  channels: alertChannels(),
  setup: alertSetup(),
}));

app.post("/api/watches", async (req, reply) => {
  const body = (req.body ?? {}) as {
    query?: string;
    mode?: DetectedKind | "auto";
    intervalMs?: number;
    intervalHours?: number;
  };
  if (!body.query?.trim()) return reply.code(400).send({ error: "query is required" });
  try {
    return createWatch({
      query: body.query,
      mode: body.mode,
      intervalMs: body.intervalMs,
      intervalHours: body.intervalHours,
    });
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/watches/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const rec = getWatch(id);
  if (!rec) return reply.code(404).send({ error: "watch not found" });
  return rec;
});

app.delete("/api/watches/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!deleteWatch(id)) return reply.code(404).send({ error: "watch not found" });
  return { ok: true };
});

app.post("/api/watches/:id/run", async (req, reply) => {
  const { id } = req.params as { id: string };
  const rec = await runWatch(id);
  if (!rec) return reply.code(404).send({ error: "watch not found" });
  return rec;
});

app.get("/api/alerts", async () => ({ alerts: listAlerts(), setup: alertSetup() }));

app.get("/api/alerts/setup", async () => alertSetup());

app.post("/api/alerts/test", async () => sendTestAlert());

app.post("/api/alerts/:id/read", async (req, reply) => {
  const { id } = req.params as { id: string };
  const rec = markAlertRead(id, true);
  if (!rec) return reply.code(404).send({ error: "alert not found" });
  return rec;
});

const clientDir = join(root, "dist/client");
if (existsSync(clientDir)) {
  await app.register(fastifyStatic, {
    root: clientDir,
    cacheControl: false,
    setHeaders(res, filePath) {
      const lower = filePath.replaceAll("\\", "/").toLowerCase();
      if (lower.endsWith("index.html") || lower.endsWith("sw.js")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      } else if (lower.includes("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return reply.sendFile("index.html");
  });
}

try {
  startWatchScheduler();
} catch (err) {
  app.log.warn({ err }, "watch scheduler failed to start; continuing without watches");
}
await app.listen({ port: PORT, host: HOST });
app.log.info(
  { cases: casesPersistMode(), watches: watchesPersistMode() },
  `Umbra listening on http://${HOST}:${PORT}`,
);
