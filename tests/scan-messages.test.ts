import { describe, expect, it } from "vitest";
import {
  MEMORY_ABORT_MESSAGE,
  MEMORY_BUSY_MESSAGE,
  explainScanAbort,
  explainScanStartError,
  isTransientHttpStatus,
} from "../shared/scan-messages.ts";

describe("user-facing scan messages", () => {
  it("maps memory / conflict starts to human copy", () => {
    expect(explainScanStartError(503, "memory pressure")).toBe(MEMORY_BUSY_MESSAGE);
    expect(explainScanStartError(409)).toMatch(/Cancel/);
    expect(explainScanStartError(500, "Scan failed")).toMatch(/HTTP 500/);
    expect(explainScanStartError(400, "query is required")).toBe("query is required");
  });

  it("explains abort reasons without a bare cancelled", () => {
    expect(explainScanAbort("memory pressure")).toBe(MEMORY_ABORT_MESSAGE);
    expect(explainScanAbort(MEMORY_ABORT_MESSAGE)).toBe(MEMORY_ABORT_MESSAGE);
    expect(explainScanAbort("cancelled by user")).toBe("Scan cancelled.");
    expect(explainScanAbort("stale timeout — no progress for 10m")).toMatch(/stalled/);
  });

  it("treats timeout and 5xx as transient", () => {
    expect(isTransientHttpStatus(503)).toBe(true);
    expect(isTransientHttpStatus(502)).toBe(true);
    expect(isTransientHttpStatus(0, "timeout")).toBe(true);
    expect(isTransientHttpStatus(404)).toBe(false);
    expect(isTransientHttpStatus(403)).toBe(false);
  });
});
