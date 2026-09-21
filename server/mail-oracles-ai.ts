import type { LedgerRow } from "../shared/types.ts";
import { type OracleVerdict } from "./oracles.ts";
import { fetchOracle, jsonStatus } from "./mail-oracle-http.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

function existsFlag(j: unknown, foundReason: string, missReason: string): OracleVerdict {
  const rec = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
  const tRPC =
    rec["0"] && typeof rec["0"] === "object"
      ? (((rec["0"] as Record<string, unknown>).result as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const tJson = tRPC?.json && typeof tRPC.json === "object" ? (tRPC.json as Record<string, unknown>) : {};
  const layers = [rec, nested, tJson];
  for (const layer of layers) {
    for (const key of ["is_email_in_use", "email_exists", "exists", "taken", "registered", "in_use"]) {
      if (layer[key] === true) return { status: "found", reason: foundReason };
      if (layer[key] === false) return { status: "miss", reason: missReason };
    }
  }
  const blob = JSON.stringify(j).toLowerCase();
  if (/already[_ ]?(in use|taken|registered)|email[_ ]exists["']?\s*:\s*true/.test(blob)) {
    return { status: "found", reason: foundReason };
  }
  if (/not[_ ]exist|available|unused|email[_ ]exists["']?\s*:\s*false/.test(blob)) {
    return { status: "miss", reason: missReason };
  }
  return { status: "escalate", reason: `${foundReason.replace(/\..*/, "")} inconclusive.` };
}

/**
 * Silent AI-product account oracles. Existence / availability only.
 *
 * Skipped (would magic-link or password-reset the subject):
 * Anthropic/Claude, Perplexity, Mistral/Le Chat, xAI/Grok, Poe.
 * Google Gemini is the existing Gmail gxlu Google-account signal.
 * Microsoft Copilot is the existing Microsoft GetCredentialType signal.
 * Pack `gemini` remains the crypto exchange — not Google Gemini.
 */
const handlers: Record<string, OracleFn> = {
  characterai: async (email) => {
    const url = "https://plus.character.ai/chat/user/check_email_exists/";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://character.ai",
        Referer: "https://character.ai/",
      },
      body: JSON.stringify({ email }),
    });
    if (res.status === 404 || res.status === 410 || (res.body && !res.body.trim().startsWith("{") && !res.body.trim().startsWith("["))) {
      const fallback = "https://beta.character.ai/chat/user/check_email_exists/";
      const retry = await fetchOracle({
        url: fallback,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://beta.character.ai",
          Referer: "https://beta.character.ai/",
        },
        body: JSON.stringify({ email }),
      });
      return jsonStatus(retry, fallback, "POST", (j) =>
        existsFlag(j, "Character.AI check_email_exists reports in use.", "Character.AI check_email_exists reports unused."),
      );
    }
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, "Character.AI check_email_exists reports in use.", "Character.AI check_email_exists reports unused."),
    );
  },
};

export { handlers as aiHandlers };
