import { describe, expect, it } from "vitest";
import { clusterPhashes, hamming, phashFromGray, phashFromRgba } from "../server/phash.ts";

function block(value: number): number[] {
  return Array.from({ length: 32 * 32 }, () => value);
}

describe("avatar pHash", () => {
  it("is stable for the same gray field and distant for opposite fields", () => {
    const a = phashFromGray(block(10));
    const b = phashFromGray(block(10));
    const c = phashFromGray(block(240));
    expect(a).toBe(b);
    expect(a.length).toBe(63);
    expect(hamming(a, c)).toBeGreaterThan(5);
  });

  it("clusters near-identical patterned avatars", () => {
    const patterned = (gain: number) => {
      const data = new Uint8Array(32 * 32 * 4);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4;
          const v = ((x ^ y) & 8 ? 200 : 40) + gain;
          data[i] = Math.min(255, v);
          data[i + 1] = Math.min(255, v - 10);
          data[i + 2] = Math.min(255, v + 10);
          data[i + 3] = 255;
        }
      }
      return data;
    };
    const ha = phashFromRgba(patterned(0), 32, 32, 4);
    const hb = phashFromRgba(patterned(6), 32, 32, 4);
    expect(hamming(ha, hb)).toBeLessThanOrEqual(16);
    const clusters = clusterPhashes(
      [
        { site: "GitHub", url: "https://github.com/a", avatarUrl: "https://x/a.png", phash: ha },
        { site: "GitLab", url: "https://gitlab.com/a", avatarUrl: "https://x/b.png", phash: hb },
      ],
      16,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sites).toEqual(expect.arrayContaining(["GitHub", "GitLab"]));
  });
});
