import { db } from "@/lib/db";
import {
  BannedEmailInput,
  WelcomeEmailInput,
  LINER_APPEAL_EMAIL,
  MAIL_FROM,
  renderBannedEmail,
  renderWelcomeEmail,
} from "@/lib/emailTemplates";

/**
 * The Liner no-reply mailer (server-side).
 *
 * Sends real transactional email from the site's no-reply identity
 * ("Liner <no-reply@jayjoice.tryliner.fun>") to real account holders:
 *
 *   welcome  → the first time an account is ever seen on this website
 *              (its own signed-in session proves the identity AND the
 *              email address — see recordUserSeen in moderation.ts)
 *   banned   → the moment the site owner applies a ban (reason + date +
 *              the JayJoice appeal contact), email resolved from the site's
 *              user cache or, failing that, a live upstream directory lookup
 *
 * Providers (first match wins):
 *   1. Resend HTTPS API     — RESEND_API_KEY            (disabled: the
 *      jayjoice.tryliner.fun domain was never verified on Resend)
 *   2. Proton SMTP          — SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS
 *      (smtp.protonmail.ch:465; the password is an SMTP token generated in
 *      Proton settings, NOT the account login password)
 *   3. Nothing configured   → sends nothing, logs "not_configured" — the
 *      site keeps working exactly as before, triggers never throw.
 *
 * Every attempt is audited in the EmailLog table; the (type, refKey) unique
 * constraint is the dedupe contract that makes the triggers idempotent
 * (welcome: one per account ever; banned: one per ban row).
 */

export { MAIL_FROM, MAIL_PUBLIC_BASE_URL, LINER_APPEAL_EMAIL } from "@/lib/emailTemplates";

/** Simple but honest address validation (no spaces, one @, has a TLD). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailAddress(email: unknown): email is string {
  return (
    typeof email === "string" &&
    email.length <= 320 &&
    EMAIL_RE.test(email.trim())
  );
}

export type MailProvider = "resend" | "smtp";

export interface SendResult {
  ok: boolean;
  provider?: MailProvider;
  /** Provider message id on success. */
  id?: string;
  /** "not_configured" | "invalid_email" | provider/http error text. */
  error?: string;
}

export interface MailContent {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Set on ban mail so appeals land in the owner's human inbox. */
  replyTo?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 12_000;

async function sendViaResend(mail: MailContent, apiKey: string): Promise<SendResult> {
  const call = (): Promise<Response> =>
    fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [mail.to.trim()],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      cache: "no-store",
    });

  let res: Response | null = null;
  try {
    res = await call();
    // one retry on transport-level failure / 5xx — same policy as the
    // moderation + announcement upstream probes
    if (!res || res.status >= 500) res = await call();
  } catch {
    return { ok: false, provider: "resend", error: "network_error" };
  }
  if (!res) return { ok: false, provider: "resend", error: "network_error" };

  let body: { id?: unknown; message?: unknown; name?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }
  if (res.ok && typeof body.id === "string") {
    return { ok: true, provider: "resend", id: body.id };
  }
  const detail =
    typeof body.message === "string"
      ? body.message.slice(0, 200)
      : `http_${res.status}`;
  return { ok: false, provider: "resend", error: detail };
}

// --- SMTP (nodemailer, lazy so bundling/tests never force it) ---------------

type SmtpTransporter = {
  sendMail: (options: Record<string, unknown>) => Promise<{ messageId?: string }>;
  close: () => void;
};

let smtpTransport: SmtpTransporter | null = null;

function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() ?? "587");
  return Boolean(host && Number.isFinite(port) && port > 0);
}

async function getSmtpTransport(): Promise<SmtpTransporter | null> {
  if (!smtpConfigured()) return null;
  if (smtpTransport) return smtpTransport;
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT?.trim() ?? "587");
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: port === 465,
    auth:
      process.env.SMTP_USER?.trim() && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER.trim(),
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  }) as unknown as SmtpTransporter;
  return smtpTransport;
}

async function sendViaSmtp(mail: MailContent): Promise<SendResult> {
  try {
    const transport = await getSmtpTransport();
    if (!transport) return { ok: false, provider: "smtp", error: "not_configured" };
    const info = await transport.sendMail({
      from: MAIL_FROM,
      to: mail.to.trim(),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    });
    return { ok: true, provider: "smtp", id: info.messageId ?? undefined };
  } catch (err) {
    return {
      ok: false,
      provider: "smtp",
      error: err instanceof Error ? err.message.slice(0, 200) : "smtp_error",
    };
  }
}

/** Send one mail through the first configured provider. Never throws. */
export async function sendEmail(mail: MailContent): Promise<SendResult> {
  if (!isValidEmailAddress(mail.to)) {
    return { ok: false, error: "invalid_email" };
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const result = await sendViaResend(mail, resendKey);
    if (result.ok) return result;
    // Provider rejections (401 bad key / 403 unverified domain / 422 bad
    // address) are FINAL — never fall back with the same content (double
    // delivery risk when both providers are configured by accident). Only a
    // transport-level network_error may hand over to a configured SMTP.
    if (result.error !== "network_error") return result;
  }
  if (smtpConfigured()) {
    return sendViaSmtp(mail);
  }
  return resendKey
    ? { ok: false, provider: "resend", error: "network_error" }
    : { ok: false, error: "not_configured" };
}

// --- Audited, deduped transactional delivery --------------------------------

export type TransactionalEmailType = "welcome" | "banned";

export interface DeliveryOutcome {
  sent: boolean;
  /** "sent" | "duplicate" | "invalid_email" | "not_configured" | error text */
  detail: string;
  provider?: MailProvider;
}

/**
 * Record the attempt in EmailLog. The unique (type, refKey) index keeps one
 * row per transactional mail; a FAILED row is overwritten by the next
 * attempt (retry-on-failed) so provider outages never permanently eat a
 * user's welcome/ban mail — only a successful send pins the row forever.
 */
async function logAttempt(input: {
  type: TransactionalEmailType;
  refKey: string;
  username: string;
  email: string;
  result: SendResult;
}): Promise<"logged" | "duplicate"> {
  try {
    await db.emailLog.upsert({
      where: { type_refKey: { type: input.type, refKey: input.refKey } },
      create: {
        type: input.type,
        refKey: input.refKey,
        username: input.username,
        email: input.email,
        provider: input.result.provider ?? null,
        status: input.result.ok ? "sent" : "failed",
        error: input.result.error ?? null,
      },
      // Only reachable when the pre-check raced a concurrent delivery that
      // actually sent — keep the original "sent" record untouched.
      update: input.result.ok
        ? {
            provider: input.result.provider ?? null,
            status: "sent",
            error: null,
          }
        : {},
    });
    return "logged";
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "P2002") return "duplicate";
    return "logged";
  }
}

/**
 * Deliver one transactional mail with a dedupe pre-check + audited outcome.
 * Returns whether the mail actually went out — the "duplicate" detail means
 * this (type, refKey) pair was already handled and must not send again.
 */
export async function deliverTransactionalEmail(input: {
  type: TransactionalEmailType;
  /** Dedupe key: username for welcome, ban row id for banned. */
  refKey: string;
  username: string;
  email: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<DeliveryOutcome> {
  const email = input.email.trim();
  try {
    if (!isValidEmailAddress(email)) {
      return { sent: false, detail: "invalid_email" };
    }
    const already = await db.emailLog.findUnique({
      where: { type_refKey: { type: input.type, refKey: input.refKey } },
      select: { status: true },
    });
    // "sent" is final — never double-deliver. A "failed" row means an earlier
    // attempt never landed, so fall through and try again.
    if (already && already.status === "sent") {
      return { sent: false, detail: "duplicate" };
    }

    const result = await sendEmail({
      to: email,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    await logAttempt({
      type: input.type,
      refKey: input.refKey,
      username: input.username,
      email,
      result,
    });
    if (result.ok) {
      console.log(
        `[mailer] ${input.type} email sent to ${input.username} <${email}> via ${result.provider}`,
      );
      return { sent: true, detail: "sent", provider: result.provider };
    }
    console.warn(
      `[mailer] ${input.type} email to ${input.username} <${email}> failed: ${result.error}`,
    );
    return {
      sent: false,
      detail: result.error ?? "send_failed",
      provider: result.provider,
    };
  } catch (err) {
    console.warn(`[mailer] ${input.type} delivery crashed:`, err);
    return { sent: false, detail: "send_failed" };
  }
}

/** Build + deliver the welcome mail (fire-and-forget safe — never throws). */
export async function deliverWelcomeEmail(input: {
  username: string;
  displayName?: string | null;
  email: string;
  accountCreatedAt: Date;
}): Promise<DeliveryOutcome> {
  const content = renderWelcomeEmail(input);
  return deliverTransactionalEmail({
    type: "welcome",
    refKey: input.username,
    username: input.username,
    email: input.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

/** Build + deliver the ban mail (Reply-To = the owner's human inbox). */
export async function deliverBannedEmail(
  input: BannedEmailInput & { email: string; banId: string },
): Promise<DeliveryOutcome> {
  const content = renderBannedEmail(input);
  return deliverTransactionalEmail({
    type: "banned",
    refKey: input.banId,
    username: input.username,
    email: input.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    replyTo: LINER_APPEAL_EMAIL,
  });
}
