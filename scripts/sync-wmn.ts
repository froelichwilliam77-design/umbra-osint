#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeMaigretSites, type MaigretSite } from "../server/maigret.ts";
import { mergeSherlockSites, type SherlockSite } from "../server/sherlock.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wmnDest = join(root, "schema", "wmn-data.json");
const sherlockDest = join(root, "schema", "sherlock-overlay.json");
const maigretDest = join(root, "schema", "maigret-overlay.json");
const wmnUrl = process.env.WMN_URL || "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json";
const sherlockUrl =
  process.env.SHERLOCK_URL ||
  "https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json";
const maigretUrl =
  process.env.MAIGRET_URL || "https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json";

const ua = { "User-Agent": "Umbra-OSINT/1.10 (schema sync)" };

const wmnRes = await fetch(wmnUrl, { headers: ua });
if (!wmnRes.ok) {
  console.error(`Failed to fetch ${wmnUrl}: HTTP ${wmnRes.status}`);
  process.exit(1);
}
const wmn = await wmnRes.json();
if (!Array.isArray(wmn.sites)) {
  console.error("Unexpected WhatsMyName document: missing sites[]");
  process.exit(1);
}
await writeFile(wmnDest, JSON.stringify(wmn, null, 2) + "\n");
console.log(`Wrote ${wmn.sites.length} WhatsMyName sites to schema/wmn-data.json`);

const shRes = await fetch(sherlockUrl, { headers: ua });
if (!shRes.ok) {
  console.error(`Sherlock fetch failed HTTP ${shRes.status} — overlay left unchanged.`);
} else {
  const sherlock = (await shRes.json()) as Record<string, SherlockSite>;
  const { sites, added, skipped } = mergeSherlockSites(wmn.sites, sherlock);
  await writeFile(
    sherlockDest,
    JSON.stringify(
      {
        source: sherlockUrl,
        importedAt: new Date().toISOString(),
        sites,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${added} Sherlock overlay sites (${skipped} skipped as duplicates/unsupported) to schema/sherlock-overlay.json`);

  const mgRes = await fetch(maigretUrl, { headers: ua });
  if (!mgRes.ok) {
    console.error(`Maigret fetch failed HTTP ${mgRes.status} — overlay left unchanged.`);
    process.exit(0);
  }
  const maigretDoc = (await mgRes.json()) as { sites?: Record<string, MaigretSite> } & Record<string, MaigretSite>;
  const siteMap = maigretDoc.sites && typeof maigretDoc.sites === "object" ? maigretDoc.sites : maigretDoc;
  const combined = [...wmn.sites, ...sites];
  const mg = mergeMaigretSites(combined, siteMap);
  await writeFile(
    maigretDest,
    JSON.stringify(
      {
        source: maigretUrl,
        importedAt: new Date().toISOString(),
        sites: mg.sites,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${mg.added} Maigret overlay sites (${mg.skipped} skipped as duplicates/unsupported) to schema/maigret-overlay.json`);
}
