import type { ScanProfile } from "../shared/scan-limits.ts";
import type { OracleSpec } from "./schema.ts";

/** High-signal silent oracles — run first so likely hits surface early. */
export const HIGH_SIGNAL_ORACLES = new Set([
  "gravatar",
  "github",
  "gitlab",
  "microsoft",
  "discord",
  "gmail",
  "proton",
  "keybase",
  "hibp",
  "hudsonrock",
  "slack",
  "bitbucket",
  "dockerhub",
  "wordpress",
  "atlassian",
  "dropbox",
  "notion",
  "openai",
  "reddit",
  "steam",
  "flickr",
  "hashnode",
  "substack",
  "huggingface",
  "adobe",
  "spotify",
  "pinterest",
  "tumblr",
  "imgur",
  "mozilla",
  "yahoo",
  "zoho",
  "replit",
  "codepen",
  "patreon",
  "shopify",
  "vimeo",
  "soundcloud",
  "medium",
  "fastmail",
  "aboutme",
  "lastfm",
  "hubspot",
  "strava",
  "eventbrite",
]);

/**
 * Low-value or chronically WAF/CAPTCHA/CSRF-blocked oracles.
 * Skipped entirely on the lean profile (still run last on full).
 */
export const LEAN_SKIP_ORACLES = new Set([
  "amocrm",
  "axonaut",
  "insightly",
  "nimble",
  "nocrm",
  "nutshell",
  "pipedrive",
  "teamleader",
  "coroflot",
  "diigo",
  "rambler",
  "sporcle",
  "ello",
  "rocketreach",
  "fanpop",
  "taringa",
  "tellonym",
  "caringbridge",
  "sevencups",
  "smule",
  "tunefind",
  "crevado",
  "bodybuilding",
  "blablacar",
  "myheritage",
  "ancestry",
  "instacart",
  "deliveroo",
  "doordash",
  "vrbo",
  "vivino",
  "bitmoji",
  "snapchat",
  "samsung",
  "nike",
  "komoot",
  "anydo",
  "freelancer",
  "envato",
  "deezer",
  "voxmedia",
  "garmin",
  "ebay",
]);

export function oraclePriority(spec: OracleSpec): number {
  if (HIGH_SIGNAL_ORACLES.has(spec.id) || HIGH_SIGNAL_ORACLES.has(spec.handler)) return 0;
  if (spec.quarantine || LEAN_SKIP_ORACLES.has(spec.id)) return 2;
  return 1;
}

export function selectMailOracles(
  oracles: OracleSpec[],
  opts: { profile?: ScanProfile; hibpKey?: boolean } = {},
): OracleSpec[] {
  const profile = opts.profile ?? "full";
  const hibpKey = opts.hibpKey ?? Boolean(process.env.HIBP_API_KEY?.trim());
  const filtered = oracles.filter((spec) => {
    if (spec.handler === "hibp" && !hibpKey) return false;
    if (profile === "lean") {
      if (spec.quarantine) return false;
      if (LEAN_SKIP_ORACLES.has(spec.id)) return false;
    }
    return true;
  });
  return [...filtered].sort((a, b) => oraclePriority(a) - oraclePriority(b) || a.name.localeCompare(b.name));
}

export function mailOracleJitter(spec: OracleSpec): { min: number; max: number } {
  return oraclePriority(spec) === 0 ? { min: 10, max: 60 } : { min: 60, max: 240 };
}
