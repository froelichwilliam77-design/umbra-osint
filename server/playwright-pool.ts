import { detectWaf } from "./classify.ts";
import type { HttpRequest, HttpResponse } from "./http.ts";
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
let chromiumLauncher: ((opts: { headless: boolean }) => Promise<PlaywrightBrowser>) | null = null;

export function playwrightEnabled(): boolean {
  const raw = (process.env.UMBRA_PLAYWRIGHT ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function playwrightMax(): number {
  return Math.min(40, Math.max(0, Number(process.env.UMBRA_PLAYWRIGHT_MAX ?? 20) || 20));
}

async function loadChromium() {
  if (playwrightTried) return chromiumLauncher;
  playwrightTried = true;
  try {
    const spec = "playwright";
    const loader = new Function("s", "return import(s)") as (s: string) => Promise<{
      chromium: { launch: (opts: { headless: boolean }) => Promise<PlaywrightBrowser> };
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

/**
 * Authorized public GET only. No form fills, no logins, no credential stuffing.
 * SSRF still applies. Used for Cloudflare/CAPTCHA rows that already classified as blocked/escalate.
 */
export async function fetchPlaywright(req: HttpRequest): Promise<HttpResponse> {
  const started = Date.now();
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return {
      ok: false,
      status: 0,
      url: req.url,
      finalUrl: req.url,
      headers: {},
      body: "",
      latencyMs: 0,
      error: "Playwright escalation is GET-only.",
      via: "playwright",
    };
  }
  try {
    await assertSafeFetchTarget(req.url);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url: req.url,
      finalUrl: req.url,
      headers: {},
      body: "",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      ssrf: true,
      via: "playwright",
    };
  }
  const launch = await loadChromium();
  if (!launch) {
    return {
      ok: false,
      status: 0,
      url: req.url,
      finalUrl: req.url,
      headers: {},
      body: "",
      latencyMs: Date.now() - started,
      error: "playwright is not installed",
      via: "playwright",
    };
  }
  const timeoutMs = req.timeoutMs ?? 18_000;
  let browser: PlaywrightBrowser | undefined;
  try {
    browser = await launch({ headless: true });
    const page = await browser.newPage();
    const resp = await page.goto(req.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const body = (await page.content()).slice(0, 512_000);
    const status = resp?.status() ?? 0;
    const headers = resp?.headers() ?? {};
    const finalUrl = resp?.url() ?? req.url;
    await page.close();
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
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url: req.url,
      finalUrl: req.url,
      headers: {},
      body: "",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      via: "playwright",
    };
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
