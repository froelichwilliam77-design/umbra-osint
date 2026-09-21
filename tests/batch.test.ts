import { describe, expect, it } from "vitest";
import { cancelBatch, createBatch, exportBatch, parseBatchLines, resetBatchesForTests } from "../server/batch.ts";

describe("batch recon queue", () => {
  it("skips blanks, comments, crawl URLs, and invalid handles", () => {
    const jobs = parseBatchLines(`
# comment
octocat
press@github.com
github.com
+14155552671

not a valid handle!!!
https://example.com/crawl-me
octocat
`);
    const queued = jobs.filter((j) => j.status === "queued");
    const skipped = jobs.filter((j) => j.status === "skipped");
    expect(queued.map((j) => j.mode)).toEqual(["handle", "mail", "host", "phone"]);
    expect(skipped.some((j) => /crawl/i.test(j.reason ?? ""))).toBe(true);
    expect(skipped.some((j) => j.reason === "duplicate")).toBe(true);
    expect(skipped.some((j) => /letter|invalid|Handle/i.test(j.reason ?? ""))).toBe(true);
  });

  it("cancels remaining queued jobs and exports combined JSON/CSV/Markdown", () => {
    resetBatchesForTests();
    const queue = createBatch("octocat\nbad!!! handle\npress@github.com", "lean");
    expect(queue.jobs.some((j) => j.status === "skipped")).toBe(true);
    const cancelled = cancelBatch(queue.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.jobs.filter((j) => j.status === "queued")).toHaveLength(0);
    const json = exportBatch(queue.id, "json");
    expect(json?.body).toMatch(/"batch"/);
    expect(json?.filename).toMatch(/umbra-batch/);
    const csv = exportBatch(queue.id, "csv");
    expect(csv?.body.startsWith("query,mode,status")).toBe(true);
    const md = exportBatch(queue.id, "md");
    expect(md?.body).toMatch(/Umbra batch/);
    expect(md?.body).toMatch(/octocat/);
    resetBatchesForTests();
  });
});
