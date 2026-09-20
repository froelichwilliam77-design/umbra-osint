import type { LedgerRow } from "../shared/types.ts";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { fetchPublicBinary } from "./http.ts";

const SIZE = 32;
const HASH_SIZE = 8;

export function hamming(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d += 1;
  return d + Math.abs(a.length - b.length);
}

function resizeGray(src: Uint8Array | number[], width: number, height: number, channels: number): number[] {
  const out = new Array<number>(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / SIZE));
      const sy = Math.min(height - 1, Math.floor((y * height) / SIZE));
      const i = (sy * width + sx) * channels;
      const r = src[i] ?? 0;
      const g = channels > 1 ? (src[i + 1] ?? r) : r;
      const b = channels > 2 ? (src[i + 2] ?? r) : r;
      out[y * SIZE + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return out;
}

function dct2(pixels: number[]): number[][] {
  const n = SIZE;
  const out: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          sum +=
            pixels[y * n + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      out[u][v] = 0.25 * cu * cv * sum;
    }
  }
  return out;
}

export function phashFromGray(pixels: number[]): string {
  const dct = dct2(pixels);
  const vals: number[] = [];
  for (let u = 0; u < HASH_SIZE; u++) {
    for (let v = 0; v < HASH_SIZE; v++) {
      if (u === 0 && v === 0) continue;
      vals.push(dct[u][v]);
    }
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return vals.map((v) => (v > median ? "1" : "0")).join("");
}

export function phashFromRgba(data: Uint8Array | number[], width: number, height: number, channels = 4): string {
  return phashFromGray(resizeGray(data, width, height, channels));
}

export function decodeAvatar(bytes: Buffer, contentType = ""): { width: number; height: number; data: Uint8Array; channels: number } | null {
  const ct = contentType.toLowerCase();
  const isJpeg = ct.includes("jpeg") || ct.includes("jpg") || bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = ct.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50);
  try {
    if (isJpeg) {
      const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 16 });
      return { width: decoded.width, height: decoded.height, data: decoded.data, channels: 4 };
    }
    if (isPng) {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, data: png.data, channels: 4 };
    }
  } catch {
    return null;
  }
  return null;
}

export async function phashFromUrl(url: string): Promise<string | undefined> {
  if (!url.startsWith("http")) return undefined;
  const res = await fetchPublicBinary(url);
  if (res.status !== 200 || res.ssrf || !res.bytes?.length) return undefined;
  const decoded = decodeAvatar(res.bytes, res.headers["content-type"] ?? "");
  if (!decoded) return undefined;
  return phashFromRgba(decoded.data, decoded.width, decoded.height, decoded.channels);
}

export interface AvatarHit {
  site: string;
  url: string;
  avatarUrl: string;
}

export function clusterPhashes(
  hits: (AvatarHit & { phash: string })[],
  maxDistance = 10,
): { phash: string; sites: string[]; avatarUrls: string[]; distanceMax: number }[] {
  const clusters: { members: (AvatarHit & { phash: string })[]; distanceMax: number }[] = [];
  for (const hit of hits) {
    let placed = false;
    for (const c of clusters) {
      const d = Math.min(...c.members.map((m) => hamming(m.phash, hit.phash)));
      if (d <= maxDistance) {
        c.members.push(hit);
        c.distanceMax = Math.max(c.distanceMax, d);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [hit], distanceMax: 0 });
  }
  return clusters
    .filter((c) => c.members.length >= 2)
    .map((c) => ({
      phash: c.members[0].phash,
      sites: [...new Set(c.members.map((m) => m.site))],
      avatarUrls: [...new Set(c.members.map((m) => m.avatarUrl))],
      distanceMax: c.distanceMax,
    }));
}

export async function hashFoundAvatars(rows: LedgerRow[], max = 36): Promise<{ hashed: number; clusters: ReturnType<typeof clusterPhashes> }> {
  const { HostPool } = await import("./concurrency.ts");
  const candidates = rows
    .filter((r) => r.status === "found" && r.metadata?.avatarUrl)
    .slice(0, max);
  const pool = new HostPool({ global: 4, perHost: 2 });
  const hits: (AvatarHit & { phash: string })[] = [];
  await Promise.all(
    candidates.map((row) =>
      pool.schedule("avatar", async () => {
        const avatarUrl = row.metadata?.avatarUrl;
        if (!avatarUrl) return;
        const hash = await phashFromUrl(avatarUrl);
        if (!hash) return;
        row.phash = hash;
        row.metadata = { ...row.metadata, phash: hash, extra: { ...row.metadata?.extra, phash: hash } };
        hits.push({ site: row.site, url: row.profileUrl || row.url, avatarUrl, phash: hash });
      }),
    ),
  );
  return { hashed: hits.length, clusters: clusterPhashes(hits) };
}
