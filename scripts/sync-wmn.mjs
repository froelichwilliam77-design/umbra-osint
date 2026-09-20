#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "schema", "wmn-data.json");
const url = process.env.WMN_URL || "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json";

const res = await fetch(url, {
  headers: { "User-Agent": "Umbra-OSINT/1.0 (schema sync)" },
});
if (!res.ok) {
  console.error(`Failed to fetch ${url}: HTTP ${res.status}`);
  process.exit(1);
}
const json = await res.json();
if (!Array.isArray(json.sites)) {
  console.error("Unexpected WhatsMyName document: missing sites[]");
  process.exit(1);
}
await writeFile(dest, JSON.stringify(json, null, 2) + "\n");
console.log(`Wrote ${json.sites.length} WhatsMyName sites to schema/wmn-data.json`);
