import type { LedgerRow, ScanCompare, ScanSummary } from "./types.ts";

export function compareScans(
  a: { summary: ScanSummary; rows: LedgerRow[] },
  b: { summary: ScanSummary; rows: LedgerRow[] },
): ScanCompare {
  const key = (r: LedgerRow) => r.site.toLowerCase();
  const foundA = a.rows.filter((r) => r.status === "found");
  const foundB = b.rows.filter((r) => r.status === "found");
  const mapA = new Map(foundA.map((r) => [key(r), r]));
  const mapB = new Map(foundB.map((r) => [key(r), r]));
  const onlyA = [...mapA.entries()]
    .filter(([k]) => !mapB.has(k))
    .map(([, r]) => ({ site: r.site, url: r.profileUrl || r.url, status: r.status }));
  const onlyB = [...mapB.entries()]
    .filter(([k]) => !mapA.has(k))
    .map(([, r]) => ({ site: r.site, url: r.profileUrl || r.url, status: r.status }));
  const both = [...mapA.entries()]
    .filter(([k]) => mapB.has(k))
    .map(([k, r]) => ({
      site: r.site,
      urlA: r.profileUrl || r.url,
      urlB: mapB.get(k)!.profileUrl || mapB.get(k)!.url,
    }));
  return {
    a: { id: a.summary.id, query: a.summary.query, mode: a.summary.mode, found: foundA.length },
    b: { id: b.summary.id, query: b.summary.query, mode: b.summary.mode, found: foundB.length },
    onlyA,
    onlyB,
    both,
  };
}
