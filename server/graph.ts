import type {
  AvatarCluster,
  DetectedKind,
  GraphEdge,
  GraphNode,
  HostDossier,
  IdentityGraph,
  LedgerRow,
  MailDossier,
  PhoneDossier,
  ScanMode,
  ScanSummary,
} from "../shared/types.ts";
import { compareScans } from "../shared/compare.ts";

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(edges: GraphEdge[], from: string, to: string, rel: string): void {
  if (from === to) return;
  if (edges.some((e) => e.from === from && e.to === to && e.rel === rel)) return;
  edges.push({ from, to, rel });
}

function pivotFor(kind: DetectedKind, query: string): { query: string; mode: ScanMode } {
  return { query, mode: kind };
}

export function buildIdentityGraph(input: {
  summary: ScanSummary;
  rows: LedgerRow[];
  clusters?: AvatarCluster[];
}): IdentityGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const centerId = `center:${input.summary.mode}:${input.summary.query}`;
  addNode(nodes, {
    id: centerId,
    kind: input.summary.mode,
    label: input.summary.query,
    pivot: pivotFor(input.summary.mode, input.summary.query),
  });

  const dossier = input.summary.dossier;
  if (dossier && "email" in dossier) {
    const d = dossier as MailDossier;
    const hostId = `host:${d.domain}`;
    addNode(nodes, {
      id: hostId,
      kind: "host",
      label: d.domain,
      pivot: { query: d.domain, mode: "host" },
    });
    addEdge(edges, centerId, hostId, "domain");
    for (const handle of d.pivots.slice(0, 8)) {
      const id = `handle:${handle}`;
      addNode(nodes, {
        id,
        kind: "handle",
        label: handle,
        pivot: { query: handle, mode: "handle" },
      });
      addEdge(edges, centerId, id, "local-part");
    }
    if (d.hibp?.enabled) {
      const hibpId = "oracle:hibp";
      addNode(nodes, {
        id: hibpId,
        kind: "oracle",
        label: d.hibp.breachCount ? `HIBP ${d.hibp.breachCount} breaches` : "HIBP clean",
        status: d.hibp.breachCount ? "found" : "miss",
        url: "https://haveibeenpwned.com/",
      });
      addEdge(edges, centerId, hibpId, "breach");
    }
  }
  if (dossier && "e164" in dossier) {
    const d = dossier as PhoneDossier;
    if (d.country) {
      const id = `region:${d.country}`;
      addNode(nodes, { id, kind: "phone", label: d.regionHint || d.country });
      addEdge(edges, centerId, id, "region");
    }
  }
  if (dossier && "domain" in dossier && !("email" in dossier)) {
    const d = dossier as HostDossier;
    for (const san of (d.cert?.san ?? []).slice(0, 6)) {
      const host = san.replace(/^\*\./, "");
      const id = `host:${host}`;
      addNode(nodes, { id, kind: "host", label: host, pivot: { query: host, mode: "host" } });
      addEdge(edges, centerId, id, "san");
    }
  }

  const found = input.rows.filter((r) => r.status === "found");
  for (const row of found.slice(0, 80)) {
    const id = `profile:${row.site}`;
    addNode(nodes, {
      id,
      kind: row.category === "oracle" || row.category === "identity" ? "oracle" : "profile",
      label: row.site,
      status: row.status,
      url: row.profileUrl || row.url,
      pivot:
        input.summary.mode === "mail" && row.category !== "dns"
          ? { query: input.summary.query.split("@")[0] ?? input.summary.query, mode: "handle" }
          : undefined,
    });
    addEdge(edges, centerId, id, "found");
    if (row.phash) {
      const av = `avatar:${row.phash.slice(0, 12)}`;
      addNode(nodes, { id: av, kind: "avatar", label: `pHash ${row.phash.slice(0, 8)}…` });
      addEdge(edges, id, av, "avatar");
    }
  }

  for (const cluster of input.clusters ?? []) {
    const av = `avatar:${cluster.phash.slice(0, 12)}`;
    addNode(nodes, {
      id: av,
      kind: "avatar",
      label: `cluster ${cluster.sites.length} avatars`,
    });
    for (const site of cluster.sites) {
      addEdge(edges, `profile:${site}`, av, "same-avatar");
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export { compareScans };
