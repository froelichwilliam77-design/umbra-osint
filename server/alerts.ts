import type { AlertChannelDelivery, AlertChannelsPublic, WatchAlert } from "../shared/types.ts";
import { alertEmailTo, sendSmtpMail, smtpConfigured, smtpFrom } from "./smtp.ts";

export function alertWebhookUrl(): string | null {
  const u = process.env.UMBRA_ALERT_WEBHOOK?.trim();
  return u || null;
}

export function resendApiKey(): string | null {
  const k = process.env.RESEND_API_KEY?.trim() || process.env.UMBRA_RESEND_API_KEY?.trim();
  return k || null;
}

export function telegramBotToken(): string | null {
  return process.env.UMBRA_TELEGRAM_BOT_TOKEN?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function telegramChatId(): string | null {
  return process.env.UMBRA_TELEGRAM_CHAT_ID?.trim() || process.env.TELEGRAM_CHAT_ID?.trim() || null;
}

export function telegramConfigured(): boolean {
  return Boolean(telegramBotToken() && telegramChatId());
}

export function resendConfigured(): boolean {
  return Boolean(resendApiKey() && alertEmailTo());
}

export function emailConfigured(): boolean {
  return resendConfigured() || smtpConfigured();
}

export function alertChannels(): AlertChannelsPublic {
  return {
    webhook: Boolean(alertWebhookUrl()),
    email: emailConfigured(),
    smtp: smtpConfigured(),
    resend: resendConfigured(),
    telegram: telegramConfigured(),
  };
}

function foundLines(alert: WatchAlert): string {
  const news = alert.newFounds
    .slice(0, 16)
    .map((f) => `+ ${f.site} — ${f.url}`)
    .join("\n");
  const gone = alert.goneFounds
    .slice(0, 8)
    .map((f) => `- ${f.site} — ${f.url}`)
    .join("\n");
  return [
    `Umbra watch alert`,
    `${alert.mode} · ${alert.query}`,
    `${alert.newFounds.length} new found(s)${alert.goneFounds.length ? ` · ${alert.goneFounds.length} gone` : ""}`,
    news,
    gone,
    "",
    "Public OSINT only. This message is for the operator inbox — Umbra never emails or SMS the subject.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

export function alertEmailSubject(alert: WatchAlert): string {
  return `Umbra: ${alert.newFounds.length} new found(s) for ${alert.mode} ${alert.query}`;
}

async function postWebhook(alert: WatchAlert): Promise<boolean> {
  const url = alertWebhookUrl();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "umbra-watch/1.8" },
      body: JSON.stringify({
        type: "umbra.alert",
        watchId: alert.watchId,
        query: alert.query,
        mode: alert.mode,
        createdAt: alert.createdAt,
        newFounds: alert.newFounds,
        goneFounds: alert.goneFounds,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendResend(subject: string, text: string): Promise<boolean> {
  const key = resendApiKey();
  const to = alertEmailTo();
  if (!key || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "user-agent": "umbra-watch/1.8",
      },
      body: JSON.stringify({
        from: smtpFrom().includes("@") ? smtpFrom() : "Umbra <alerts@resend.dev>",
        to: [to],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendEmail(alert: WatchAlert): Promise<boolean> {
  if (!emailConfigured()) return false;
  const subject = alertEmailSubject(alert);
  const text = foundLines(alert);
  if (resendConfigured()) {
    const ok = await sendResend(subject, text);
    if (ok) return true;
  }
  if (smtpConfigured()) return sendSmtpMail(subject, text);
  return false;
}

async function sendTelegram(alert: WatchAlert): Promise<boolean> {
  const token = telegramBotToken();
  const chat = telegramChatId();
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "umbra-watch/1.8" },
      body: JSON.stringify({
        chat_id: chat,
        text: foundLines(alert).slice(0, 3900),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fan out to every configured operator channel. In-app alerts are persisted by the caller. */
export async function deliverAlert(alert: WatchAlert): Promise<AlertChannelDelivery> {
  const channels = alertChannels();
  const out: AlertChannelDelivery = {};
  const tasks: Promise<void>[] = [];
  if (channels.webhook) {
    tasks.push(
      postWebhook(alert).then((ok) => {
        out.webhook = ok;
      }),
    );
  }
  if (channels.email) {
    tasks.push(
      sendEmail(alert).then((ok) => {
        out.email = ok;
      }),
    );
  }
  if (channels.telegram) {
    tasks.push(
      sendTelegram(alert).then((ok) => {
        out.telegram = ok;
      }),
    );
  }
  await Promise.all(tasks);
  return out;
}
