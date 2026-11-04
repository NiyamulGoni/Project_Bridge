import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailResult {
  sent: boolean;
  previewUrl?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<MailResult>;
}

let transportPromise: Promise<Transporter> | undefined;

async function createTransport(): Promise<Transporter> {
  if (config.mail.host) {
    return nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  const account = await nodemailer.createTestAccount();
  console.warn(
    `[mail] WARNING: SMTP is not configured (SMTP_HOST is empty). Emails go to the Ethereal test inbox ${account.user} and will NOT reach real addresses. Use the Preview link printed below each email.`,
  );
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

/** Real SMTP, or an automatically created Ethereal inbox when SMTP is not configured. */
export const smtpMailer: Mailer = {
  async send(mail) {
    if (!config.isProd) {
      // Demo safety net: the link is still reachable if the network fails.
      console.log(`[mail] To ${mail.to}: ${mail.subject}\n${mail.text}`);
    }
    try {
      transportPromise ??= createTransport();
      const info = await (await transportPromise).sendMail({ from: config.mail.from, ...mail });
      const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
      if (previewUrl) console.log(`[mail] Preview: ${previewUrl}`);
      return { sent: true, previewUrl };
    } catch (err) {
      console.error(`[mail] Sending to ${mail.to} failed: ${(err as Error).message}`);
      transportPromise = undefined;
      return { sent: false };
    }
  },
};

/** In-memory outbox used by the automated tests. */
export class MemoryMailer implements Mailer {
  outbox: Mail[] = [];
  async send(mail: Mail): Promise<MailResult> {
    this.outbox.push(mail);
    return { sent: true };
  }
}

let current: Mailer = config.mail.transport === 'memory' ? new MemoryMailer() : smtpMailer;

export function getMailer(): Mailer {
  return current;
}

export function setMailer(mailer: Mailer): void {
  current = mailer;
}
