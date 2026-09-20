import type { HibpBreach, HibpDossier } from "../shared/types.ts";
import { fetchPublic } from "./http.ts";

const SKIPPED = "Have I Been Pwned skipped — set HIBP_API_KEY for live breach lookup.";

export function hibpEnabled(): boolean {
  return Boolean(process.env.HIBP_API_KEY?.trim());
}

export function emptyHibp(skipped = SKIPPED): HibpDossier {
  return { enabled: false, skipped, breachCount: 0, breaches: [] };
}

export function parseHibpBreaches(body: string): HibpBreach[] {
  try {
    const raw = JSON.parse(body) as {
      Name?: string;
      Title?: string;
      Domain?: string;
      BreachDate?: string;
      PwnCount?: number;
      DataClasses?: string[];
    }[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((b) => b?.Name)
      .map((b) => ({
        name: String(b.Name),
        title: b.Title,
        domain: b.Domain,
        breachDate: b.BreachDate,
        pwnCount: b.PwnCount,
        dataClasses: b.DataClasses,
      }));
  } catch {
    return [];
  }
}

export async function lookupHibp(email: string): Promise<HibpDossier> {
  const key = process.env.HIBP_API_KEY?.trim();
  if (!key) return emptyHibp();
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  const res = await fetchPublic({
    url,
    headers: { "hibp-api-key": key, "user-agent": "Umbra-OSINT" },
    accept: "application/json",
  });
  if (res.status === 404) {
    return { enabled: true, breachCount: 0, breaches: [] };
  }
  if (res.status === 200) {
    const breaches = parseHibpBreaches(res.body);
    return { enabled: true, breachCount: breaches.length, breaches };
  }
  if (res.status === 401) {
    return emptyHibp("HIBP_API_KEY was rejected (HTTP 401).");
  }
  if (res.status === 429) {
    return { enabled: true, skipped: "HIBP rate-limited (HTTP 429).", breachCount: 0, breaches: [] };
  }
  return {
    enabled: true,
    skipped: `HIBP HTTP ${res.status}${res.error ? ` · ${res.error}` : ""}`,
    breachCount: 0,
    breaches: [],
  };
}
