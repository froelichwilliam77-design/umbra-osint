import type { HibpBreach, HibpDossier } from "../shared/types.ts";
import { fetchPublicRetry } from "./http.ts";

const SKIPPED =
  "Have I Been Pwned skipped — set HIBP_API_KEY (Railway Variables) for live breach names and dates. Umbra never emails the subject.";

export function hibpEnabled(): boolean {
  return Boolean(process.env.HIBP_API_KEY?.trim());
}

export function hibpPasteLinks(email: string): { label: string; url: string }[] {
  const q = encodeURIComponent(email);
  return [
    { label: "HIBP account", url: `https://haveibeenpwned.com/account/${q}` },
    { label: "Hudson Rock (stealer)", url: `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${q}` },
    { label: "Paste search", url: `https://www.google.com/search?q=%22${q}%22+(pastebin|ghostbin|rentry|dpaste|paste)` },
    { label: "GitHub gists", url: `https://gist.github.com/search?q=${q}` },
    { label: "IntelX", url: `https://intelx.io/?s=${q}` },
    { label: "LeakIX", url: `https://leakix.net/search?q=${q}` },
  ];
}

export function emptyHibp(skipped = SKIPPED): HibpDossier {
  return { enabled: false, skipped, breachCount: 0, breaches: [], pasteLinks: [] };
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
  const pasteLinks = hibpPasteLinks(email);
  const key = process.env.HIBP_API_KEY?.trim();
  if (!key) return { ...emptyHibp(), pasteLinks };
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  const res = await fetchPublicRetry(
    {
      url,
      headers: { "hibp-api-key": key, "user-agent": "Umbra-OSINT" },
      accept: "application/json",
    },
    2,
  );
  if (res.status === 404) {
    return { enabled: true, breachCount: 0, breaches: [], pasteLinks };
  }
  if (res.status === 200) {
    const breaches = parseHibpBreaches(res.body);
    return { enabled: true, breachCount: breaches.length, breaches, pasteLinks };
  }
  if (res.status === 401) {
    return { ...emptyHibp("HIBP_API_KEY was rejected (HTTP 401). Check the key in Railway Variables."), pasteLinks };
  }
  if (res.status === 429) {
    return { enabled: true, skipped: "HIBP rate-limited (HTTP 429). Retry shortly.", breachCount: 0, breaches: [], pasteLinks };
  }
  return {
    enabled: true,
    skipped: `HIBP HTTP ${res.status}${res.error ? ` · ${res.error}` : ""}`,
    breachCount: 0,
    breaches: [],
    pasteLinks,
  };
}
