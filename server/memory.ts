import { memoryHardMb, memorySoftMb } from "./limits.ts";

export type MemoryPressure = "ok" | "soft" | "hard";

export class ScanAbortError extends Error {
  constructor(message = "Scan aborted: memory pressure") {
    super(message);
    this.name = "ScanAbortError";
  }
}

let rssReader: () => number = () => process.memoryUsage().rss;

/** Test hook — restore with `setRssReaderForTests(null)`. */
export function setRssReaderForTests(fn: (() => number) | null): void {
  rssReader = fn ?? (() => process.memoryUsage().rss);
}

export function rssBytes(): number {
  return rssReader();
}

export function rssMb(): number {
  return Math.round(rssBytes() / (1024 * 1024));
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
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  softMb: number;
  hardMb: number;
  pressure: MemoryPressure;
} {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round(rssBytes() / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    externalMb: Math.round(mem.external / (1024 * 1024)),
    softMb: memorySoftMb(),
    hardMb: Math.max(memoryHardMb(), memorySoftMb() + 32),
    pressure: memoryPressure(),
  };
}
