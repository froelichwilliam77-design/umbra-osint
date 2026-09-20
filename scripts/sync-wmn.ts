#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeSherlockSites, type SherlockSite } from "../server/sherlock.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wmnDest = join(root, "schema", "wmn-data.json");
const sherlockDest = join(root, "schema", "sherlock-overlay.json");
const wmnUrl = process.env.WMN_URL || "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json";
const sherlockUrl =
  process.env.SHERLOCK_URL ||
  "https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json";

const wmnRes = await fetch(wmnUrl, { headers: { "User-Agent": "Umbra-OSINT/1.2 (schema sync)" } });
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

const shRes = await fetch(sherlockUrl, { headers: { "User-Agent": "Umbra-OSINT/1.2 (schema sync)" } });
if (!shRes.ok) {
  console.error(`Sherlock fetch failed HTTP ${shRes.status} — overlay left unchanged.`);
  process.exit(0);
}
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
