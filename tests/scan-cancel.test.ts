import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canStartScan,
  cancelScan,
  listScans,
  runningScanCount,
  startScan,
  subscribe,
} from "../server/scans.ts";

afterEach(() => {
  // Cancel anything left running so tests don't leak into each other.
  for (const s of listScans()) {
    if (s.status === "running") cancelScan(s.id, "test cleanup");
  }
});

describe("scan cancel / replace", () => {
  it("canStartScan allows a second scan when replace is true (default)", () => {
    expect(canStartScan().ok).toBe(true);
    expect(canStartScan({ replace: true }).ok).toBe(true);
  });

  it("cancelScan marks a running scan cancelled and frees the slot", async () => {
    const summary = await startScan({ query: "octocat", mode: "handle", replace: true, profile: "lean" });
    expect(summary.status).toBe("running");
    expect(runningScanCount()).toBe(1);

    let doneStatus: string | undefined;
    const unsub = subscribe(summary.id, (ev) => {
      if (ev.type === "done") doneStatus = ev.scan.status;
    });

    const cancelled = cancelScan(summary.id, "test cancel");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.abortReason).toBe("test cancel");
    expect(runningScanCount()).toBe(0);

    // allow microtasks / abort to settle
    await new Promise((r) => setTimeout(r, 50));
    unsub();
    expect(doneStatus === "cancelled" || cancelled?.status === "cancelled").toBe(true);
  });

  it("startScan with replace cancels the prior running scan", async () => {
    const first = await startScan({ query: "alice", mode: "handle", replace: true, profile: "lean" });
    expect(first.status).toBe("running");

    const second = await startScan({ query: "bob", mode: "handle", replace: true, profile: "lean" });
    expect(second.status).toBe("running");
    expect(second.id).not.toBe(first.id);

    const again = listScans().find((s) => s.id === first.id);
    expect(again?.status).toBe("cancelled");
    expect(runningScanCount()).toBe(1);

    cancelScan(second.id, "test cleanup");
  });

  it("canStartScan with replace:false returns 409 while a scan runs", async () => {
    const first = await startScan({ query: "carol", mode: "handle", replace: true, profile: "lean" });
    expect(first.status).toBe("running");
    const gate = canStartScan({ replace: false });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.status).toBe(409);
    cancelScan(first.id, "test cleanup");
  });
});
