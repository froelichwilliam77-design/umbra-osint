import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size, paint) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y);
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const idat = gzipSync(raw);
  const iend = Buffer.alloc(0);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", iend)]);
}

function logo(size) {
  const cx = size / 2;
  const cy = size / 2;
  return png(size, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy) / (size / 2);
    const angle = Math.atan2(dy, dx);
    const ring = Math.abs(r - 0.42) < 0.06 || Math.abs(r - 0.22) < 0.045;
    const sweep = r < 0.72 && r > 0.08 && Math.abs(((angle + Math.PI * 1.2) % (Math.PI * 2)) - 0.35) < 0.18;
    const core = r < 0.09;
    if (core || ring || sweep) return [139, 124, 247];
    return [12, 14, 20];
  });
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "client", "public", "icons");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "icon-192.png"), logo(192));
writeFileSync(join(dir, "icon-512.png"), logo(512));
writeFileSync(join(dir, "apple-touch-icon.png"), logo(180));
console.log("wrote PWA icons");
