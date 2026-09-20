import type { HostDossier, LedgerRow, MailDossier, PhoneDossier, ScanSummary } from "./types.ts";

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
  if (scan.dossier && "domain" in scan.dossier && !("email" in scan.dossier)) {
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
