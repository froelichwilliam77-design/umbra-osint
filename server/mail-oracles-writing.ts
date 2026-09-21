import type { LedgerRow } from "../shared/types.ts";
import { type OracleVerdict } from "./oracles.ts";
import { fetchOracle, jsonStatus, takenOrAvailable } from "./mail-oracle-http.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

function availabilityFlag(j: unknown, foundReason: string, missReason: string): OracleVerdict {
  const rec = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
  if (rec.available === true || nested.available === true) return { status: "miss", reason: missReason };
  if (rec.available === false || nested.available === false) return { status: "found", reason: foundReason };
  if (rec.exists === true || nested.exists === true) return { status: "found", reason: foundReason };
  if (rec.exists === false || nested.exists === false) return { status: "miss", reason: missReason };
  const blob = JSON.stringify(j).toLowerCase();
  if (/already|taken|exists|registered|unavailable/.test(blob) && !/not[_ ]exist|available/.test(blob)) {
    return { status: "found", reason: foundReason };
  }
  if (/available|free|unused/.test(blob)) return { status: "miss", reason: missReason };
  return { status: "escalate", reason: `${foundReason.replace(/\..*/, "")} inconclusive.` };
}

/**
 * Silent writing-platform oracles. GET availability / validate only — never
 * password-reset or magic-link mail to the subject.
 */
const handlers: Record<string, OracleFn> = {
  scribd: async (email) => {
    const url = `https://www.scribd.com/account-settings/email-availability?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      accept: "application/json",
      headers: { Referer: "https://www.scribd.com/signup", "X-Requested-With": "XMLHttpRequest" },
    });
    if (res.body && !res.body.trim().startsWith("{") && !res.body.trim().startsWith("[")) {
      return takenOrAvailable(res, url, "GET", {
        taken: ["already taken", "already in use", "already registered", "unavailable"],
        available: ["available", "can be used"],
        foundReason: "Scribd email-availability reports the address is taken.",
        missReason: "Scribd email-availability reports the address is unused.",
      });
    }
    return jsonStatus(res, url, "GET", (j) =>
      availabilityFlag(j, "Scribd email-availability reports taken.", "Scribd email-availability reports unused."),
    );
  },
  academia: async (email) => {
    const url = `https://www.academia.edu/signup_validate?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      accept: "application/json",
      headers: { Referer: "https://www.academia.edu/signup", "X-Requested-With": "XMLHttpRequest" },
    });
    if (res.body && !res.body.trim().startsWith("{") && !res.body.trim().startsWith("[")) {
      return takenOrAvailable(res, url, "GET", {
        taken: ["already been taken", "already registered", "already in use", "has already been"],
        available: ["ok", "valid", "available"],
        foundReason: "Academia.edu signup_validate reports the address is taken.",
        missReason: "Academia.edu signup_validate did not flag the address as taken.",
      });
    }
    return jsonStatus(res, url, "GET", (j) =>
      availabilityFlag(j, "Academia.edu signup_validate reports taken.", "Academia.edu signup_validate reports unused."),
    );
  },
};

export { handlers as writingHandlers };
