import type { LedgerRow, ScanSummary } from "../shared/types.ts";
import { exportExecutiveHtml, exportJson, exportMarkdown } from "../shared/exports.ts";

export { exportJson, exportMarkdown };

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}


export function exportJsonl(scan: ScanSummary, rows: LedgerRow[]): string {
  return [JSON.stringify({ type: "scan", scan }), ...rows.map((r) => JSON.stringify({ type: "row", row: r }))].join(
    "\n",
  ) + "\n";
}

export function exportCsv(rows: LedgerRow[]): string {
  const header = [
    "status",
    "site",
    "category",
    "target",
    "url",
    "httpStatus",
    "reason",
    "latencyMs",
    "profileUrl",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.status,
        r.site,
        r.category,
        r.target,
        r.url,
        String(r.httpStatus ?? ""),
        r.reason,
        String(r.latencyMs ?? ""),
        r.profileUrl ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function exportHtml(scan: ScanSummary, rows: LedgerRow[]): string {
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const rowHtml = rows
    .map(
      (r) => `<tr class="${r.status}">
        <td>${esc(r.status)}</td>
        <td>${esc(r.site)}</td>
        <td>${esc(r.category)}</td>
        <td>${r.httpStatus ?? ""}</td>
        <td><a href="${esc(r.profileUrl || r.url)}">${esc(r.profileUrl || r.url)}</a></td>
        <td>${esc(r.reason)}</td>
      </tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<title>Umbra report — ${esc(scan.query)}</title>
<style>
  body { background:#07080c; color:#e8e6e1; font:14px/1.45 "IBM Plex Sans",system-ui,sans-serif; margin:32px; }
  a { color:#8b7cf7; }
  table { border-collapse:collapse; width:100%; }
  th,td { border-bottom:1px solid #242a38; padding:8px 10px; text-align:left; vertical-align:top; }
  .found { color:#5ee0a8; } .blocked { color:#f5a524; } .escalate { color:#c084fc; } .error { color:#f07178; }
  h1 { font-weight:500; }
</style>
<h1>Umbra · ${esc(scan.query)}</h1>
<p>Mode ${esc(scan.mode)} · found ${scan.progress.found} · miss ${scan.progress.miss} · blocked ${scan.progress.blocked}</p>
<table>
  <thead><tr><th>Status</th><th>Site</th><th>Cat</th><th>HTTP</th><th>URL</th><th>Reason</th></tr></thead>
  <tbody>${rowHtml}</tbody>
</table>
</html>`;
}

export function renderExport(
  format: string,
  scan: ScanSummary,
  rows: LedgerRow[],
): { body: string; contentType: string; filename: string } {
  const base = `umbra-${scan.mode}-${scan.query.replace(/[^\w.@-]+/g, "_")}`;
  switch (format) {
    case "json":
      return { body: exportJson(scan, rows), contentType: "application/json", filename: `${base}.json` };
    case "jsonl":
      return { body: exportJsonl(scan, rows), contentType: "application/x-ndjson", filename: `${base}.jsonl` };
    case "csv":
      return { body: exportCsv(rows), contentType: "text/csv", filename: `${base}.csv` };
    case "html":
      return { body: exportExecutiveHtml(scan, rows), contentType: "text/html", filename: `${base}.html` };
    case "md":
    case "markdown":
      return { body: exportMarkdown(scan, rows), contentType: "text/markdown", filename: `${base}.md` };
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}
