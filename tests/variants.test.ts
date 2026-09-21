import { describe, expect, it } from "vitest";
import { handleVariants, variantHandleCap, variantSiteCap, variantsEnabled } from "../server/variants.ts";

describe("handle variants", () => {
  it("generates separator swaps, digit strip, and capped extras from a seed", () => {
    const v = handleVariants("ada.lovelace", 8);
    expect(v).toContain("ada_lovelace");
    expect(v).toContain("ada-lovelace");
    expect(v).toContain("adalovelace");
    expect(v).not.toContain("ada.lovelace");
    expect(v.length).toBeLessThanOrEqual(8);
  });

  it("strips trailing digits and does not invent unrelated names", () => {
    const v = handleVariants("octocat42", 6);
    expect(v).toContain("octocat");
    expect(v.every((x) => x.includes("octocat") || x.replace(/\d+/g, "").includes("octocat"))).toBe(true);
  });

  it("keeps lean caps small and full/power larger", () => {
    expect(variantHandleCap("lean")).toBeLessThanOrEqual(4);
    expect(variantSiteCap("lean")).toBeLessThanOrEqual(80);
    expect(variantHandleCap("full", true)).toBeGreaterThan(variantHandleCap("lean"));
    expect(variantSiteCap("full", true)).toBeGreaterThan(variantSiteCap("lean"));
  });

  it("can be disabled via env", () => {
    const prev = process.env.UMBRA_VARIANTS;
    process.env.UMBRA_VARIANTS = "0";
    expect(variantsEnabled()).toBe(false);
    expect(variantsEnabled(true)).toBe(true);
    if (prev == null) delete process.env.UMBRA_VARIANTS;
    else process.env.UMBRA_VARIANTS = prev;
  });
});
