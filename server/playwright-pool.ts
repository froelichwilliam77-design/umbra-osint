import pLimit from "p-limit";
import { detectWaf } from "./classify.ts";
import type { HttpRequest, HttpResponse } from "./http.ts";
import { bodyLimit, playwrightConcurrent, playwrightRetryMax } from "./limits.ts";
import { isSoftMemoryPressure } from "./memory.ts";
import { assertSafeFetchTarget } from "./ssrf.ts";

type PlaywrightBrowser = {
  newPage: () => Promise<{
    goto: (
      url: string,
      opts: { waitUntil: string; timeout: number },
    ) => Promise<{ status: () => number; url: () => string; headers: () => Record<string, string> } | null>;
    content: () => Promise<string>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
};

let playwrightTried = false;
let chromiumLauncher:
  | ((opts: { headless: boolean; args?: string[] }) => Promise<PlaywrightBrowser>)
  | null = null;

const browserGate = pLimit(playwrightConcurrent());

export function playwrightEnabled(): boolean {
  const raw = (process.env.UMBRA_PLAYWRIGHT ?? "").trim().toLowerCase();
  // Explicit opt-in only. Unset / anything else stays OFF (Railway 1 GB OOM).
  return raw === "1" || raw === "true" || raw === "on";
}

let playwrightUsed = 0;

export function takePlaywrightSlot(): boolean {
  if (!playwrightEnabled()) return false;
  if (playwrightUsed >= playwrightMax()) return false;
  playwrightUsed += 1;
  return true;
}

export function playwrightSlotsUsed(): number {
  return playwrightUsed;
}

export function playwrightMax(): number {
  return playwrightRetryMax();
}

export { playwrightConcurrent };

async function loadChromium() {
  if (playwrightTried) return chromiumLauncher;
  playwrightTried = true;
  try {
    const spec = "playwright";
    const loader = new Function("s", "return import(s)") as (s: string) => Promise<{
      chromium: {
        launch: (opts: { headless: boolean; args?: string[] }) => Promise<PlaywrightBrowser>;
      };
    }>;
    const mod = await loader(spec);
    chromiumLauncher = mod.chromium.launch.bind(mod.chromium) as typeof chromiumLauncher;
  } catch {
    chromiumLauncher = null;
  }
  return chromiumLauncher;
}

export async function playwrightAvailable(): Promise<boolean> {
  if (!playwrightEnabled()) return false;
  const launch = await loadChromium();
  return Boolean(launch);
}

function skipped(req: HttpRequest, started: number, error: string): HttpResponse {
  return {
    ok: false,
    status: 0,
    url: req.url,
    finalUrl: req.url,
    headers: {},
    body: "",
    latencyMs: Date.now() - started,
    error,
    via: "playwright",
  };
}

/**
 * Authorized public GET only. No form fills, no logins, no credential stuffing.
 * SSRF still applies. Used for Cloudflare/CAPTCHA rows that already classified as blocked/escalate.
 * Serial: at most one Chromium at a time, killed after each navigation.
 */
export async function fetchPlaywright(req: HttpRequest): Promise<HttpResponse> {
  const started = Date.now();
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return skipped(req, started, "Playwright escalation is GET-only.");
  }
  if (!playwrightEnabled()) {
    return skipped(req, started, "Playwright is disabled (set UMBRA_PLAYWRIGHT=1 to enable).");
  }
  if (isSoftMemoryPressure()) {
    return skipped(req, started, "Playwright skipped: memory pressure");
  }
  try {
    await assertSafeFetchTarget(req.url);
  } catch (err) {
    return {
      ...skipped(req, started, err instanceof Error ? err.message : String(err)),
      ssrf: true,
    };
  }
  return browserGate(() => fetchPlaywrightSerial(req, started));
}

async function fetchPlaywrightSerial(req: HttpRequest, started: number): Promise<HttpResponse> {
  if (isSoftMemoryPressure()) {
    return skipped(req, started, "Playwright skipped: memory pressure");
  }
  const launch = await loadChromium();
  if (!launch) {
    return skipped(req, started, "playwright is not installed");
  }
  const timeoutMs = req.timeoutMs ?? 18_000;
  let browser: PlaywrightBrowser | undefined;
  try {
    browser = await launch({
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-extensions",
        "--js-flags=--max-old-space-size=128",
      ],
    });
    const page = await browser.newPage();
    try {
      const resp = await page.goto(req.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      const body = (await page.content()).slice(0, bodyLimit());
      const status = resp?.status() ?? 0;
      const headers = resp?.headers() ?? {};
      const finalUrl = resp?.url() ?? req.url;
      return {
        ok: status >= 200 && status < 300,
        status,
        url: req.url,
        finalUrl,
        headers,
        body,
        latencyMs: Date.now() - started,
        via: "playwright",
      };
    } finally {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    return skipped(req, started, err instanceof Error ? err.message : String(err));
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}

export function shouldEscalateBrowser(status: string, reason: string, method: string): boolean {
  if (method !== "GET") return false;
  if (status !== "blocked" && status !== "escalate") return false;
  const r = reason.toLowerCase();
  return (
    r.includes("cloudflare") ||
    r.includes("captcha") ||
    r.includes("challenge") ||
    r.includes("waf") ||
    r.includes("just a moment") ||
    r.includes("403") ||
    r.includes("neither exist nor missing")
  );
}

export function stillChallenged(res: HttpResponse): boolean {
  return Boolean(
    detectWaf({
      status: res.status,
      body: res.body,
      headers: res.headers,
    }),
  );
}
