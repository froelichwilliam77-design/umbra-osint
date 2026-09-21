import { describe, expect, it } from "vitest";
import {
  AI_ACCOUNT_SIGNALS,
  AI_CHAT_DISCLAIMER,
  aiChatProbeCount,
  aiKindChip,
  aiSearchQueries,
  annotateAiOracle,
  emptyAiChatDossier,
  extractAiShareUrls,
  extractHttpUrls,
  isPublicAiSharePage,
  unwrapDuckDuckGoHref,
} from "../server/ai-chats.ts";
import { handlers } from "../server/mail-oracles.ts";
import { HIGH_SIGNAL_ORACLES, selectMailOracles } from "../server/mail-priority.ts";
import { mailScanSiteCount } from "../server/mail.ts";
import { loadSchema } from "../server/schema.ts";

describe("AI chat public OSINT", () => {
  it("extracts documented public share URLs and ignores invented ids", () => {
    const text = `
      see https://chatgpt.com/share/e/70a1b2c3-d4e5-6789-abcd-ef0123456789 and
      https://claude.ai/share/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee plus
      https://poe.com/s/abc123xyz leftover https://example.com/not-a-share
    `;
    const hits = extractAiShareUrls(text);
    expect(hits.some((h) => h.product === "ChatGPT" && h.url.includes("/share/e/"))).toBe(true);
    expect(hits.some((h) => h.product === "Claude")).toBe(true);
    expect(hits.some((h) => h.product === "Poe")).toBe(true);
    expect(extractAiShareUrls("no links here, certainly not a uuid")).toEqual([]);
  });

  it("unwraps DuckDuckGo redirect hrefs", () => {
    const href = "/l/?uddg=https%3A%2F%2Fchatgpt.com%2Fshare%2Faaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(unwrapDuckDuckGoHref(href)).toContain("chatgpt.com/share/");
    const html = `<a href="${href}">ChatGPT</a> https://claude.ai/share/11111111-2222-3333-4444-555555555555`;
    expect(extractHttpUrls(html).some((u) => u.includes("chatgpt.com/share"))).toBe(true);
  });

  it("classifies public share pages vs login walls vs missing", () => {
    expect(isPublicAiSharePage(200, "<title>My chat</title><p>shared conversation</p>", "https://chatgpt.com/share/x").readable).toBe(
      true,
    );
    expect(
      isPublicAiSharePage(200, "<title>Login</title>sign in to continue", "https://chatgpt.com/share/x").blocked,
    ).toBe(true);
    expect(isPublicAiSharePage(404, "not found", "https://chatgpt.com/share/x").readable).toBe(false);
    expect(isPublicAiSharePage(403, "waf", "https://chatgpt.com/share/x").blocked).toBe(true);
  });

  it("keeps lean search cheaper than full and labels the disclaimer", () => {
    expect(aiSearchQueries("ada@example.com", "lean").length).toBeLessThan(aiSearchQueries("ada@example.com", "full").length);
    expect(aiChatProbeCount("lean")).toBeLessThan(aiChatProbeCount("full", true));
    const d = emptyAiChatDossier("ada@example.com");
    expect(d.disclaimer).toBe(AI_CHAT_DISCLAIMER);
    expect(d.disclaimer).toMatch(/not a private transcript/i);
    expect(d.searchLinks.length).toBeGreaterThan(3);
    expect(d.publicShares).toEqual([]);
  });

  it("annotates AI account-signal oracles without claiming a transcript", () => {
    const openai = annotateAiOracle({ id: "openai", handler: "openai" }, "OpenAI accounts/exists=true.", {});
    expect(openai.reason).toContain(AI_CHAT_DISCLAIMER);
    expect(openai.metadata?.extra?.aiKind).toBe("account-signal");
    expect(openai.metadata?.extra?.product).toBe("ChatGPT");
    expect(aiKindChip(openai.metadata?.extra)).toBe("AI account");

    const gmail = annotateAiOracle({ id: "gmail", handler: "gmail" }, "Gmail gxlu issued Set-Cookie.", {});
    expect(gmail.reason).toContain("Gemini");
    expect(gmail.metadata?.extra?.aiKind).toBe("account-signal");

    const copilot = annotateAiOracle({ id: "microsoft", handler: "microsoft" }, "Microsoft IfExistsResult=0.", {});
    expect(copilot.reason).toContain("Copilot");
    expect(AI_ACCOUNT_SIGNALS.huggingface.product).toBe("HuggingChat");
  });

  it("ships silent ChatGPT + Character.AI oracles on lean and skips magic-link products", () => {
    expect(handlers.openai).toBeTypeOf("function");
    expect(handlers.characterai).toBeTypeOf("function");
    expect(HIGH_SIGNAL_ORACLES.has("openai")).toBe(true);
    expect(HIGH_SIGNAL_ORACLES.has("characterai")).toBe(true);
    const schema = loadSchema();
    const openai = schema.oracles.find((o) => o.id === "openai");
    const cai = schema.oracles.find((o) => o.id === "characterai");
    const gemini = schema.oracles.find((o) => o.id === "gemini");
    expect(openai?.category).toBe("ai");
    expect(cai?.category).toBe("ai");
    expect(gemini?.category).toBe("finance");
    const lean = selectMailOracles(schema.oracles, { profile: "lean", hibpKey: false });
    expect(lean.some((o) => o.id === "openai")).toBe(true);
    expect(lean.some((o) => o.id === "characterai")).toBe(true);
    for (const id of ["anthropic", "claude", "perplexity", "mistral", "grok", "poe"]) {
      expect(handlers[id], id).toBeUndefined();
      expect(schema.oracles.some((o) => o.id === id), id).toBe(false);
    }
    expect(mailScanSiteCount("lean")).toBeLessThan(mailScanSiteCount("full"));
    expect(mailScanSiteCount("lean")).toBeGreaterThan(40);
  });
});
