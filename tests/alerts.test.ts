import { afterEach, describe, expect, it, vi } from "vitest";
import { alertChannels, alertEmailSubject, alertSetup, deliverAlert, sendTestAlert } from "../server/alerts.ts";
import { formatRfc822, smtpConfigured } from "../server/smtp.ts";
import type { WatchAlert } from "../shared/types.ts";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
  vi.unstubAllGlobals();
});

function alert(): WatchAlert {
  return {
    id: "a1",
    watchId: "w1",
    query: "octocat",
    mode: "handle",
    createdAt: new Date().toISOString(),
    newFounds: [{ site: "GitHub", url: "https://github.com/octocat", status: "found" }],
    goneFounds: [],
    read: false,
  };
}

describe("alert channels", () => {
  it("reports webhook, smtp/resend, and telegram from env", () => {
    delete process.env.UMBRA_ALERT_WEBHOOK;
    delete process.env.UMBRA_SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    delete process.env.UMBRA_TELEGRAM_BOT_TOKEN;
    expect(alertChannels()).toEqual({
      webhook: false,
      email: false,
      smtp: false,
      resend: false,
      telegram: false,
    });
    process.env.UMBRA_ALERT_WEBHOOK = "https://example.com/hook";
    process.env.UMBRA_SMTP_HOST = "smtp.example.com";
    process.env.UMBRA_ALERT_EMAIL = "ops@example.com";
    process.env.RESEND_API_KEY = "re_test";
    process.env.UMBRA_TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.UMBRA_TELEGRAM_CHAT_ID = "42";
    const ch = alertChannels();
    expect(ch.webhook).toBe(true);
    expect(ch.smtp).toBe(true);
    expect(ch.resend).toBe(true);
    expect(ch.email).toBe(true);
    expect(ch.telegram).toBe(true);
    expect(smtpConfigured()).toBe(true);
  });

  it("formats operator-only RFC822 without the watch subject as recipient", () => {
    const msg = formatRfc822({
      from: "umbra@localhost",
      to: "ops@example.com",
      subject: "Umbra: 1 new found(s) for handle octocat",
      text: "public OSINT",
    });
    expect(msg).toMatch(/To: ops@example.com/);
    expect(msg).not.toMatch(/To: octocat@/);
    expect(alertEmailSubject(alert())).toMatch(/octocat/);
  });

  it("fans out webhook, Resend, and Telegram (never SMS)", async () => {
    process.env.UMBRA_ALERT_WEBHOOK = "https://hooks.example/umbra";
    process.env.RESEND_API_KEY = "re_test";
    process.env.UMBRA_ALERT_EMAIL = "ops@example.com";
    process.env.UMBRA_TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.UMBRA_TELEGRAM_CHAT_ID = "99";
    const hits: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        hits.push(url);
        if (url.includes("hooks.example")) expect(init?.method).toBe("POST");
        if (url.includes("resend.com")) {
          const body = JSON.parse(String(init?.body)) as { to: string[] };
          expect(body.to).toEqual(["ops@example.com"]);
        }
        if (url.includes("api.telegram.org")) expect(url).toContain("sendMessage");
        expect(url).not.toMatch(/twilio|sms/i);
        return new Response("{}", { status: 200 });
      },
    );
    const delivered = await deliverAlert(alert());
    expect(delivered.webhook).toBe(true);
    expect(delivered.email).toBe(true);
    expect(delivered.telegram).toBe(true);
    expect(hits.some((u) => u.includes("hooks.example"))).toBe(true);
    expect(hits.some((u) => u.includes("resend.com"))).toBe(true);
    expect(hits.some((u) => u.includes("api.telegram.org"))).toBe(true);
  });

  it("describes configured channels without exposing secrets", () => {
    process.env.UMBRA_TELEGRAM_BOT_TOKEN = "123:secret-token-value";
    process.env.UMBRA_TELEGRAM_CHAT_ID = "42";
    process.env.HIBP_API_KEY = "hibp-secret";
    const setup = alertSetup();
    expect(setup.channels.telegram).toBe(true);
    expect(setup.hibp.configured).toBe(true);
    const blob = JSON.stringify(setup);
    expect(blob).not.toMatch(/secret-token-value/);
    expect(blob).not.toMatch(/hibp-secret/);
    expect(setup.hints.telegram.vars).toContain("UMBRA_TELEGRAM_BOT_TOKEN");
    expect(setup.note).toMatch(/operator inbox/i);
  });

  it("sends a test alert to configured channels only", async () => {
    process.env.UMBRA_ALERT_WEBHOOK = "https://hooks.example/umbra";
    delete process.env.RESEND_API_KEY;
    delete process.env.UMBRA_TELEGRAM_BOT_TOKEN;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        expect(String(input)).toContain("hooks.example");
        return new Response("{}", { status: 200 });
      },
    );
    const result = await sendTestAlert();
    expect(result.ok).toBe(true);
    expect(result.delivered.webhook).toBe(true);
    expect(result.message).toMatch(/Test alert sent/);
  });
});
