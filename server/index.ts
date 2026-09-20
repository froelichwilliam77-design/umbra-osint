import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORIZED_USE } from "../shared/constants.ts";
import type { ScanMode } from "../shared/types.ts";
import { renderExport } from "./exports.ts";
import { importWmnPayload, reloadSchema, schemaStats } from "./schema.ts";
import { getScan, listScans, startScan, subscribe } from "./scans.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || process.env.UMBRA_PORT || 43180);
const HOST = process.env.HOST || "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/api/health", async () => ({
  ok: true,
  name: "umbra",
  warning: AUTHORIZED_USE,
  proxy: Boolean(process.env.UMBRA_PROXY),
  tlsImpersonation: false,
  tlsNote:
    "Node/undici with browser-matched headers, HTTP/2, UA rotation, and optional SOCKS/HTTP proxy. curl-impersonate / rquest is not bundled.",
}));

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

app.post("/api/scans", async (req, reply) => {
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
  return { scan: stored.summary, rows: stored.rows };
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
  await app.register(fastifyStatic, { root: clientDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: PORT, host: HOST });
app.log.info(`Umbra listening on http://${HOST}:${PORT}`);
