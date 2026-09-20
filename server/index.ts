import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanMode } from "../shared/types.ts";
import { renderExport } from "./exports.ts";
import { healthPayload } from "./health.ts";
import { importWmnPayload, reloadSchema, schemaStats } from "./schema.ts";
import { canStartScan, compareStored, getScan, listScans, startScan, subscribe } from "./scans.ts";

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
  const gate = canStartScan();
  if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
  const body = (req.body ?? {}) as {
    query?: string;
    mode?: ScanMode;
    includeNsfw?: boolean;
    workers?: number;
    perHost?: number;
  };
  if (!body.query || !body.query.trim()) {
    return reply.code(400).send({ error: "query is required" });
  }
  const scan = await startScan({
    query: body.query,
    mode: body.mode,
    includeNsfw: body.includeNsfw,
    workers: body.workers,
    perHost: body.perHost,
  });
  return scan;
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

const clientDir = join(root, "dist/client");
if (existsSync(clientDir)) {
  await app.register(fastifyStatic, {
    root: clientDir,
    setHeaders(res, filePath) {
      const lower = filePath.replaceAll("\\", "/").toLowerCase();
      if (lower.endsWith("index.html") || lower.endsWith("/sw.js") || lower.endsWith("sw.js")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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

await app.listen({ port: PORT, host: HOST });
app.log.info(`Umbra listening on http://${HOST}:${PORT}`);
