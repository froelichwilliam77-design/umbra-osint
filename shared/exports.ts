import type {
  CrawlDossier,
  HostDossier,
  LedgerRow,
  MailDossier,
  PhoneDossier,
  SavedCase,
  ScanSummary,
} from "./types.ts";

export function exportJson(scan: ScanSummary, rows: LedgerRow[]): string {
  return JSON.stringify({ scan, rows }, null, 2);
}

export function exportMarkdown(scan: ScanSummary, rows: LedgerRow[]): string {
  const found = rows.filter((r) => r.status === "found");
  const lines = [
    `# Umbra report — ${scan.query}`,
    "",
    `- Mode: **${scan.mode}**`,
    `- Started: ${scan.createdAt}`,
    `- Finished: ${scan.finishedAt ?? "in progress"}`,
    `- Sites: ${scan.siteCount}`,
    `- Found: ${scan.progress.found} · Miss: ${scan.progress.miss} · Blocked: ${scan.progress.blocked} · Escalate: ${scan.progress.escalate} · Error: ${scan.progress.error}`,
    "",
    "## Authorized use",
    "",
    "Public OSINT only. Umbra does not send SMTP or password-reset mail. Phone mode never sends SMS.",
    "",
  ];
  if (scan.dossier && "email" in scan.dossier) {
    const d = scan.dossier as MailDossier;
    lines.push(
      "## Mail dossier",
      "",
      `- Email: \`${d.email}\``,
      `- Provider: ${d.providerGuess ?? "unknown"}`,
      `- Disposable: ${d.disposable}`,
      `- MX: ${d.mx.map((m) => m.exchange).join(", ") || "none"}`,
      `- SPF: ${d.domainSpf[0]?.raw ?? "none"}`,
      `- DMARC: ${d.domainDmarc[0]?.raw ?? "none"}`,
      `- DKIM: ${d.dkim.map((x) => x.selector).join(", ") || "none"}`,
      `- Gravatar: ${d.gravatar?.exists ? d.gravatar.displayName ?? "yes" : "no"}`,
      `- Local-part patterns: ${d.localPartAnalysis.patterns.join(", ") || "none"}`,
      `- Open in: ${d.openLinks?.map((l) => `[${l.label}](${l.url})`).join(" · ") || "none"}`,
      "",
    );
    if (d.hibp) {
      lines.push(
        "## Have I Been Pwned",
        "",
        d.hibp.enabled
          ? `- Breaches: **${d.hibp.breachCount}**`
          : `- Skipped: ${d.hibp.skipped ?? "HIBP_API_KEY not set"}`,
      );
      for (const b of d.hibp.breaches.slice(0, 20)) {
        lines.push(
          `- ${b.title || b.name}${b.breachDate ? ` (${b.breachDate})` : ""}${b.domain ? ` · ${b.domain}` : ""}`,
        );
      }
      lines.push("");
    }
  }
  if (scan.dossier && "dns" in scan.dossier && "domain" in scan.dossier) {
    const d = scan.dossier as HostDossier;
    lines.push(
      "## Host dossier",
      "",
      `- Domain: \`${d.domain}\``,
      `- A: ${d.dns.a.join(", ") || "none"}`,
      `- MX: ${d.dns.mx.map((m) => m.exchange).join(", ") || "none"}`,
      `- SPF: ${d.spf[0]?.raw ?? "none"}`,
      `- DMARC: ${d.dmarc[0]?.raw ?? "none"}`,
      `- DKIM: ${d.dkim.map((x) => x.selector).join(", ") || "none"}`,
      `- RDAP registrar: ${d.rdap?.registrar ?? "unknown"}`,
      `- HTTPS title: ${d.https?.title ?? "n/a"}`,
      `- Cert SAN: ${d.cert?.san.slice(0, 8).join(", ") || "n/a"}`,
      "",
    );
  }
  if (scan.dossier && "e164" in scan.dossier) {
    const d = scan.dossier as PhoneDossier;
    lines.push(
      "## Phone dossier",
      "",
      `- E.164: \`${d.e164 ?? "n/a"}\``,
      `- Valid: ${d.valid}`,
      `- Country: ${d.country ?? "unknown"}`,
      `- Type: ${d.type ?? "unknown"}`,
      `- Region: ${d.regionHint ?? "n/a"}`,
      `- Carrier hint: ${d.carrierHint ?? "n/a"}`,
      `- Timezones: ${d.timezones.join(", ") || "n/a"}`,
      `- Public links: ${d.openLinks?.map((l) => `[${l.label}](${l.url})`).join(" · ") || "none"}`,
      "",
    );
  }
  if (scan.dossier && "kind" in scan.dossier && scan.dossier.kind === "crawl") {
    const d = scan.dossier as CrawlDossier;
    lines.push(
      "## Crawl dossier",
      "",
      `- Seed: ${d.seed}`,
      `- Origin: ${d.origin} (same-origin, max ${d.maxPages} pages)`,
      `- Pages: ${d.pages} · skipped ${d.skipped} · SSRF/blocked ${d.blocked}`,
      `- Title: ${d.title ?? "n/a"}`,
      `- Emails: ${d.emails.slice(0, 24).join(", ") || "none"}`,
      `- Usernames: ${d.usernames.slice(0, 24).join(", ") || "none"}`,
      `- Links: ${d.links.length}`,
      "",
    );
  }
  lines.push("## Found", "");
  if (!found.length) lines.push("_No found rows._", "");
  for (const r of found) {
    lines.push(`- **${r.site}** (${r.category}) — ${r.profileUrl || r.url} — ${r.reason}`);
  }
  lines.push("", "## Ledger", "", "| Status | Site | Category | HTTP | Reason |", "|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.status} | ${r.site} | ${r.category} | ${r.httpStatus ?? ""} | ${r.reason.replaceAll("|", "/")} |`);
  }
  return lines.join("\n") + "\n";
}

function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Print-ready executive HTML. Browser File → Print → Save as PDF is the 1 GB-safe PDF path. */
export function exportExecutiveHtml(scan: ScanSummary, rows: LedgerRow[], opts?: { caseSavedAt?: string }): string {
  const found = rows.filter((r) => r.status === "found");
  const dossierBits: string[] = [];
  if (scan.dossier && "email" in scan.dossier) {
    const d = scan.dossier as MailDossier;
    dossierBits.push(
      `<h2>Mail dossier</h2><ul>
        <li>Email <code>${escHtml(d.email)}</code></li>
        <li>Provider ${escHtml(d.providerGuess ?? "unknown")}</li>
        <li>MX ${escHtml(d.mx.map((m) => m.exchange).join(", ") || "none")}</li>
        <li>SPF ${escHtml(d.domainSpf[0]?.raw ?? "none")}</li>
        <li>DMARC ${escHtml(d.domainDmarc[0]?.raw ?? "none")}</li>
        <li>Gravatar ${d.gravatar?.exists ? escHtml(d.gravatar.displayName ?? "yes") : "no"}</li>
        ${d.hibp?.enabled ? `<li>HIBP breaches <strong>${d.hibp.breachCount}</strong></li>` : ""}
      </ul>`,
    );
  }
  if (scan.dossier && "dns" in scan.dossier) {
    const d = scan.dossier as HostDossier;
    dossierBits.push(
      `<h2>Host dossier</h2><ul>
        <li>Domain <code>${escHtml(d.domain)}</code></li>
        <li>Registrar ${escHtml(d.rdap?.registrar ?? "unknown")}</li>
        <li>A ${escHtml(d.dns.a.join(", ") || "none")}</li>
        <li>HTTPS ${escHtml(d.https?.title ?? "n/a")} (${d.https?.status ?? "—"})</li>
        <li>Cert SAN ${escHtml(d.cert?.san.slice(0, 8).join(", ") || "n/a")}</li>
      </ul>`,
    );
  }
  if (scan.dossier && "e164" in scan.dossier) {
    const d = scan.dossier as PhoneDossier;
    dossierBits.push(
      `<h2>Phone dossier</h2><ul>
        <li>E.164 <code>${escHtml(d.e164 ?? "n/a")}</code></li>
        <li>Country ${escHtml(d.country ?? "unknown")} · ${escHtml(d.type ?? "unknown")}</li>
        <li>Region ${escHtml(d.regionHint ?? "n/a")}</li>
      </ul>`,
    );
  }
  if (scan.dossier && "kind" in scan.dossier && scan.dossier.kind === "crawl") {
    const d = scan.dossier as CrawlDossier;
    dossierBits.push(
      `<h2>Crawl dossier</h2><ul>
        <li>Seed ${escHtml(d.seed)}</li>
        <li>Same-origin ${escHtml(d.origin)} · ${d.pages}/${d.maxPages} pages</li>
        <li>Emails ${escHtml(d.emails.slice(0, 20).join(", ") || "none")}</li>
        <li>Usernames ${escHtml(d.usernames.slice(0, 20).join(", ") || "none")}</li>
      </ul>`,
    );
  }
  const foundRows = found
    .map(
      (r) => `<tr>
        <td>${escHtml(r.site)}</td>
        <td>${escHtml(r.category)}</td>
        <td><a href="${escHtml(r.profileUrl || r.url)}">${escHtml(r.profileUrl || r.url)}</a></td>
        <td>${escHtml(r.reason)}</td>
      </tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Umbra executive report — ${escHtml(scan.query)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; color: #16181d; background: #fff; margin: 0; padding: 32px; max-width: 960px; }
  h1 { font-weight: 600; font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: .04em; text-transform: uppercase; color: #3d4450; }
  .meta, li { color: #3d4450; }
  .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0 8px; }
  .kpi { border: 1px solid #d8dbe3; border-radius: 8px; padding: 10px 14px; min-width: 88px; }
  .kpi b { display: block; font-size: 20px; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e6e8ee; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5c6370; }
  a { color: #3b348f; }
  .foot { margin-top: 32px; font-size: 12px; color: #5c6370; }
  .print { margin: 12px 0 24px; }
  @media print {
    .print { display: none; }
    body { padding: 0; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
  <p class="print"><button onclick="window.print()">Print / Save as PDF</button> — no headless Chrome required.</p>
  <h1>Umbra executive report</h1>
  <p class="meta"><strong>${escHtml(scan.query)}</strong> · ${escHtml(scan.mode)}${scan.profile ? ` · ${escHtml(scan.profile)}` : ""} · ${escHtml(scan.createdAt)}${scan.finishedAt ? ` → ${escHtml(scan.finishedAt)}` : ""}${opts?.caseSavedAt ? ` · saved ${escHtml(opts.caseSavedAt)}` : ""}</p>
  <div class="kpis">
    <div class="kpi"><b>${scan.progress.found}</b>found</div>
    <div class="kpi"><b>${scan.progress.miss}</b>miss</div>
    <div class="kpi"><b>${scan.progress.blocked}</b>blocked</div>
    <div class="kpi"><b>${scan.progress.escalate}</b>escalate</div>
    <div class="kpi"><b>${scan.siteCount}</b>sites</div>
  </div>
  ${dossierBits.join("\n")}
  <h2>Findings</h2>
  ${found.length ? `<table><thead><tr><th>Site</th><th>Cat</th><th>URL</th><th>Reason</th></tr></thead><tbody>${foundRows}</tbody></table>` : "<p>No found rows.</p>"}
  <p class="foot">Authorized use only. Public OSINT. Umbra does not send SMTP, password-reset mail, or SMS. Private/loopback fetches are blocked (SSRF).</p>
</body>
</html>`;
}

export function exportCaseJson(rec: SavedCase): string {
  return JSON.stringify(rec, null, 2);
}
