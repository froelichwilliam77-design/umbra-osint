import { AUTHORIZED_USE } from "../shared/constants.ts";
import { umbraVersion } from "./version.ts";
import { impersonateHealth } from "./curl-impersonate.ts";
import { scanLimitsPublic } from "./limits.ts";
import { memorySnapshot } from "./memory.ts";
import { casesPersistMode } from "./cases.ts";
import { powerPublic } from "./power.ts";
import { alertChannels, alertSetup, alertWebhookUrl } from "./alerts.ts";
import { sharesPersistMode } from "./shares.ts";
import { watchesPersistMode } from "./watches.ts";
import {
  playwrightAvailable,
  playwrightConcurrent,
  playwrightEnabled,
  playwrightMax,
} from "./playwright-pool.ts";

export async function healthPayload() {
  const tls = impersonateHealth();
  return {
    ok: true,
    name: "umbra",
    version: umbraVersion(),
    warning: AUTHORIZED_USE,
    proxy: Boolean(process.env.UMBRA_PROXY),
    hibp: Boolean(process.env.HIBP_API_KEY?.trim()),
    hibpNote: process.env.HIBP_API_KEY?.trim()
      ? "HIBP live — breaches land in the mail dossier."
      : "Set HIBP_API_KEY in Railway Variables for Have I Been Pwned. Without it the HIBP card stays off (not a fake miss).",
    cases: { persist: casesPersistMode() },
    shares: { persist: sharesPersistMode() },
    watches: {
      persist: watchesPersistMode(),
      webhook: Boolean(alertWebhookUrl()),
      channels: alertChannels(),
    },
    alerts: alertSetup(),
    power: powerPublic(),
    playwright: {
      enabled: playwrightEnabled(),
      available: await playwrightAvailable(),
      max: playwrightMax(),
      concurrent: playwrightConcurrent(),
    },
    memory: memorySnapshot(),
    limits: scanLimitsPublic(),
    pwa: true,
    phone: true,
    ...tls,
  };
}
