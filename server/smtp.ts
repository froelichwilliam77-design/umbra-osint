import { connect as tlsConnect } from "node:tls";
import { createConnection } from "node:net";
import type { Socket } from "node:net";

export function smtpHost(): string | null {
  return process.env.UMBRA_SMTP_HOST?.trim() || null;
}

export function smtpPort(): number {
  const n = Number(process.env.UMBRA_SMTP_PORT || 587);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 587;
}

export function smtpFrom(): string {
  return (
    process.env.UMBRA_SMTP_FROM?.trim() ||
    process.env.UMBRA_ALERT_EMAIL_FROM?.trim() ||
    process.env.UMBRA_SMTP_USER?.trim() ||
    "umbra@localhost"
  );
}

export function alertEmailTo(): string | null {
  const to = process.env.UMBRA_ALERT_EMAIL?.trim() || process.env.UMBRA_ALERT_TO?.trim();
  return to || null;
}

export function smtpConfigured(): boolean {
  return Boolean(smtpHost() && alertEmailTo());
}

export function formatRfc822(opts: { from: string; to: string; subject: string; text: string }): string {
  const date = new Date().toUTCString();
  const subject = opts.subject.replace(/[\r\n]+/g, " ");
  const body = opts.text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
  ].join("\r\n");
}

function readLine(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP timeout"));
    }, timeoutMs);
    const onData = (buf: Buffer) => {
      cleanup();
      resolve(buf.toString("utf8"));
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onErr);
    };
    socket.once("data", onData);
    socket.once("error", onErr);
  });
}

async function expectCode(socket: Socket, code: number, timeoutMs = 12_000): Promise<string> {
  const raw = await readLine(socket, timeoutMs);
  const line = raw.split(/\r?\n/).filter(Boolean).pop() ?? raw;
  if (!line.startsWith(String(code))) {
    throw new Error(`SMTP expected ${code}, got: ${line.trim().slice(0, 180)}`);
  }
  return line;
}

async function command(socket: Socket, line: string, code: number): Promise<string> {
  socket.write(`${line}\r\n`);
  return expectCode(socket, code);
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Minimal AUTH LOGIN SMTP. Port 465 uses implicit TLS; 587 uses STARTTLS.
 * Operator inbox only — never the watch subject.
 */
export async function sendSmtpMail(subject: string, text: string): Promise<boolean> {
  const host = smtpHost();
  const to = alertEmailTo();
  if (!host || !to) return false;
  const port = smtpPort();
  const user = process.env.UMBRA_SMTP_USER?.trim();
  const pass = process.env.UMBRA_SMTP_PASS ?? "";
  const from = smtpFrom();
  const implicitTls = port === 465 || process.env.UMBRA_SMTP_SECURE?.trim() === "1";
  const timeoutMs = 12_000;

  const open = (): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const onErr = (err: Error) => reject(err);
      if (implicitTls) {
        const sock = tlsConnect({ host, port, servername: host, timeout: timeoutMs }, () => {
          sock.off("error", onErr);
          resolve(sock);
        });
        sock.once("error", onErr);
        return;
      }
      const sock = createConnection({ host, port, timeout: timeoutMs }, () => {
        sock.off("error", onErr);
        resolve(sock);
      });
      sock.once("error", onErr);
    });

  let socket: Socket | undefined;
  try {
    socket = await open();
    socket.setEncoding("utf8");
    await expectCode(socket, 220);
    await command(socket, `EHLO umbra`, 250);
    if (!implicitTls) {
      socket.write("STARTTLS\r\n");
      await expectCode(socket, 220);
      socket = await new Promise<Socket>((resolve, reject) => {
        const upgraded = tlsConnect({ socket, servername: host, timeout: timeoutMs }, () => resolve(upgraded));
        upgraded.once("error", reject);
      });
      socket.setEncoding("utf8");
      await command(socket, `EHLO umbra`, 250);
    }
    if (user) {
      await command(socket, "AUTH LOGIN", 334);
      await command(socket, b64(user), 334);
      await command(socket, b64(pass), 235);
    }
    await command(socket, `MAIL FROM:<${from}>`, 250);
    await command(socket, `RCPT TO:<${to}>`, 250);
    await command(socket, "DATA", 354);
    const payload = formatRfc822({ from, to, subject, text });
    socket.write(`${payload.replace(/^\./gm, "..")}\r\n.\r\n`);
    await expectCode(socket, 250);
    socket.write("QUIT\r\n");
    return true;
  } catch {
    return false;
  } finally {
    try {
      socket?.end();
      socket?.destroy();
    } catch {
      /* ignore */
    }
  }
}
