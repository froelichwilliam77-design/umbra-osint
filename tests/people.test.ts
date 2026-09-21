import { describe, expect, it } from "vitest";
import { peopleSearchLinks } from "../server/people.ts";
import { phoneOpenLinks } from "../server/phone.ts";
import { exportExecutiveHtml, exportMarkdown } from "../shared/exports.ts";
import type { LedgerRow, ScanSummary } from "../shared/types.ts";

describe("people search + client brief", () => {
  it("emits public search URLs only (no broker scrape endpoints)", () => {
    const mail = peopleSearchLinks("press@github.com", "mail");
    expect(mail.some((l) => /linkedin\.com/.test(l.url))).toBe(true);
    expect(mail.some((l) => /epieos\.com/.test(l.url))).toBe(true);
    expect(mail.every((l) => l.url.startsWith("https://"))).toBe(true);
    expect(mail.every((l) => !/buy|checkout|cart/i.test(l.url))).toBe(true);
    const phone = peopleSearchLinks("+14155552671", "phone");
    expect(phone.length).toBeGreaterThan(3);
    expect(phoneOpenLinks("+14155552671", "US").some((l) => l.label === "Telegram (search)")).toBe(true);
  });

  it("includes identity, pastes, and CT in the printable brief", () => {
    const scan: ScanSummary = {
      id: "s",
      query: "press@github.com",
      mode: "mail",
      requestedMode: "mail",
      createdAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      status: "done",
      preflight: { ok: true, kind: "mail", query: "press@github.com", normalized: "press@github.com", notes: [], warnings: [], errors: [] },
      progress: { done: 1, total: 1, found: 1, miss: 0, blocked: 0, escalate: 0, error: 0, invalid: 0 },
      includeNsfw: false,
      siteCount: 1,
      dossier: {
        email: "press@github.com",
        localPart: "press",
        domain: "github.com",
        disposable: false,
        roleBased: true,
        plusAddress: false,
        mx: [],
        hasMx: true,
        domainSpf: [],
        domainDmarc: [],
        dkim: [],
        pivots: ["press"],
        localPartAnalysis: { localPart: "press", base: "press", patterns: [], possibleNames: [] },
        openLinks: [],
        pastes: {
          disclaimer: "Public paste search only",
          searchLinks: [],
          hits: [{ site: "Pastebin", url: "https://pastebin.com/abc12345", confidence: "medium" }],
        },
        aiChats: {
          disclaimer: "Public share / account signal",
          searchLinks: [],
          publicShares: [{ product: "ChatGPT", url: "https://chatgpt.com/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", readable: true }],
        },
      },
      identityClusters: [
        {
          id: "handle:press",
          label: "Same handle @press",
          kind: "handle",
          confidence: 0.8,
          reasons: ["Username on 2 sites"],
          members: [{ site: "GitHub", url: "https://github.com/press" }],
        },
      ],
    };
    const rows: LedgerRow[] = [
      {
        id: "r",
        scanId: "s",
        mode: "mail",
        target: "press@github.com",
        site: "GitHub",
        category: "oracle",
        status: "found",
        reason: "taken",
        url: "https://github.com",
        method: "GET",
      },
    ];
    const md = exportMarkdown(scan, rows, {
      notes: [{ id: "n1", at: "2026-01-01T00:00:00.000Z", text: "Client asked for a brief.", via: "operator" }],
      identityClusters: scan.identityClusters,
    });
    expect(md).toMatch(/Identity clusters/);
    expect(md).toMatch(/Public pastes/);
    expect(md).toMatch(/ChatGPT/);
    expect(md).toMatch(/Operator notes/);
    const html = exportExecutiveHtml(scan, rows, { identityClusters: scan.identityClusters });
    expect(html).toMatch(/Print \/ Save as PDF/);
    expect(html).toMatch(/Identity clusters/);
    expect(html).toMatch(/client brief|executive report/);
  });
});
