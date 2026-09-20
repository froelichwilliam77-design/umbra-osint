import { AUTHORIZED_USE } from "../shared/constants.ts";
import { impersonateHealth } from "./curl-impersonate.ts";
import { scanLimitsPublic } from "./limits.ts";
import { memorySnapshot } from "./memory.ts";
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
    version: "1.3.0",
    warning: AUTHORIZED_USE,
    proxy: Boolean(process.env.UMBRA_PROXY),
    hibp: Boolean(process.env.HIBP_API_KEY?.trim()),
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
