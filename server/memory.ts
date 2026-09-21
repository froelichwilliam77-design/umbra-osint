import { existsSync, readFileSync } from "node:fs";
import { MEMORY_ABORT_MESSAGE } from "../shared/scan-messages.ts";
import { memoryHardMb, memorySoftMb } from "./limits.ts";

export type MemoryPressure = "ok" | "soft" | "hard";

export class ScanAbortError extends Error {
  constructor(message = MEMORY_ABORT_MESSAGE) {
    super(message);
    this.name = "ScanAbortError";
  }
}

const CGROUP_CURRENT = [
  "/sys/fs/cgroup/memory.current",
  "/sys/fs/cgroup/memory/memory.usage_in_bytes",
];

/** Cgroup usage includes curl-impersonate children; process RSS does not. */
export function readCgroupBytes(): number | null {
  for (const p of CGROUP_CURRENT) {
    try {
      if (!existsSync(p)) continue;
      const n = Number(readFileSync(p, "utf8").trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* next */
    }
  }
  return null;
}

function defaultRssReader(): number {
  const proc = process.memoryUsage().rss;
  const cg = readCgroupBytes();
  return cg != null ? Math.max(cg, proc) : proc;
}

let rssReader: () => number = defaultRssReader;

/** Test hook — restore with `setRssReaderForTests(null)`. */
export function setRssReaderForTests(fn: (() => number) | null): void {
  rssReader = fn ?? defaultRssReader;
}

export function rssBytes(): number {
  return rssReader();
}

export function rssMb(): number {
  return Math.round(rssBytes() / (1024 * 1024));
}

export function processRssMb(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

export function memoryPressure(): MemoryPressure {
  const rss = rssMb();
  const hard = Math.max(memoryHardMb(), memorySoftMb() + 32);
  if (rss >= hard) return "hard";
  if (rss >= memorySoftMb()) return "soft";
  return "ok";
}

export function isSoftMemoryPressure(): boolean {
  return memoryPressure() !== "ok";
}

export function isHardMemoryPressure(): boolean {
  return memoryPressure() === "hard";
}

export function memorySnapshot(): {
  rssMb: number;
  processRssMb: number;
  cgroupMb: number | null;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  softMb: number;
  hardMb: number;
  pressure: MemoryPressure;
} {
  const mem = process.memoryUsage();
  const cg = readCgroupBytes();
  return {
    rssMb: rssMb(),
    processRssMb: processRssMb(),
    cgroupMb: cg == null ? null : Math.round(cg / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    externalMb: Math.round(mem.external / (1024 * 1024)),
    softMb: memorySoftMb(),
    hardMb: Math.max(memoryHardMb(), memorySoftMb() + 32),
    pressure: memoryPressure(),
  };
}
