import { AUTHORIZED_USE } from "../shared/constants.ts";
import { umbraVersion } from "./version.ts";
import { impersonateHealth } from "./curl-impersonate.ts";
import { scanLimitsPublic } from "./limits.ts";
import { memorySnapshot } from "./memory.ts";
import { casesPersistMode } from "./cases.ts";
import { powerPublic } from "./power.ts";
import { alertWebhookUrl, watchesPersistMode } from "./watches.ts";
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
    cases: { persist: casesPersistMode() },
    watches: { persist: watchesPersistMode(), webhook: Boolean(alertWebhookUrl()) },
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
