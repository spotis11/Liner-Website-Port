/**
 * Transactional email templates for the Liner website port.
 *
 * Pure string builders — no db, no network, no nodemailer — so they are
 * trivially unit-testable and safe to import from any server route.
 *
 * Two mails, exactly as the site owner specified:
 *  - "welcome":  account created  → banner + "Welcome to Liner, (user)!"
 *                + creation date + "Listen to your favorite music!" +
 *                "Cheers mate!" — Liner System
 *  - "banned":   account banned   → banner + "Hello (user)" + the ban reason
 *                + ban date + the JayJoice (cryptojay.eth) appeal contact
 *
 * Emails are rendered as table-based HTML (dark Liner theme) + a plain-text
 * mirror, with inline styles only — mail clients strip <style> tags and CSS
 * classes, so every rule must live on the element itself.
 */

/** Mirror of the server-side reason cap (BAN_REASON_MAX). */
export const BAN_REASON_DISPLAY_MAX = 300;

/** Public origin the mail clients use to load the banner images from. */
export const MAIL_PUBLIC_BASE_URL = (
  process.env.MAIL_PUBLIC_BASE_URL ?? "https://tryliner.fun"
).replace(/\/+$/, "");

/** Sender identity for every no-reply mail (overridable for deliverability testing). */
export const MAIL_FROM =
  process.env.MAIL_FROM ?? "Liner <no-reply@jayjoice.tryliner.fun>";

/** Human appeal inbox from the owner's ban template. */
export const LINER_APPEAL_EMAIL = "seekfromohio@gmail.com";

export type EmailKind = "welcome" | "banned";

export interface WelcomeEmailInput {
  username: string;
  displayName?: string | null;
  /** When the Liner account itself was created (upstream /v1/me createdAt). */
  accountCreatedAt: Date;
}

export interface BannedEmailInput {
  username: string;
  displayName?: string | null;
  /** Owner-written ban reason (null = none given). */
  reason: string | null;
  bannedAt: Date;
  /** Does the ban ever expire? Renders the expiry line when set. */
  expiresAt?: Date | null;
}

/** Escape untrusted values (usernames, reasons) for HTML interpolation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip control chars + caps a string for safe email header/body use. */
function clean(value: string | null | undefined, max: number): string {
  if (!value) return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/** "October 30, 2026 at 02:39 PM (UTC)" — explicit timezone, unambiguous. */
export function formatEmailDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
  return `${formatted} (UTC)`;
}

/** The name shown in greetings: display name when the account has one. */
export function emailDisplayName(input: {
  username: string;
  displayName?: string | null;
}): string {
  const name = clean(input.displayName, 60);
  return name || clean(input.username, 30) || "there";
}

function bannerUrl(file: string): string {
  return `${MAIL_PUBLIC_BASE_URL}/emails/${file}`;
}

/** Shared dark shell: 600px card, full-width banner, inline-styled body. */
function layout(options: {
  bannerFile: string;
  bannerAlt: string;
  innerHtml: string;
  preheader: string;
}): string {
  const { bannerFile, bannerAlt, innerHtml, preheader } = options;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Liner</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0817;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0d0817;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#150c26;border-radius:16px;overflow:hidden;border:1px solid #2c1f4a;">
<tr><td style="font-size:0;line-height:0;" align="center">
<a href="${MAIL_PUBLIC_BASE_URL}" target="_blank" style="text-decoration:none;">
<img src="${bannerUrl(bannerFile)}" alt="${escapeHtml(bannerAlt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
</a>
</td></tr>
<tr><td style="padding:36px 36px 20px 36px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#f3effc;">
${innerHtml}
</td></tr>
<tr><td style="padding:0 36px 32px 36px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #2c1f4a;padding-top:18px;font-size:12px;line-height:18px;color:#8f83ad;">
This is an automatic message from the Liner system — sent from ${escapeHtml(MAIL_FROM.replace(/<.*>/, "").trim() || "Liner")}'s no-reply address.<br>
Liner &middot; <a href="${MAIL_PUBLIC_BASE_URL}" target="_blank" style="color:#a78bfa;text-decoration:underline;">${escapeHtml(MAIL_PUBLIC_BASE_URL.replace(/^https?:\/\//, ""))}</a>
</td></tr></table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return html;
}

const FONT = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;";
const H1 = `font-size:26px;line-height:34px;font-weight:700;color:#ffffff;margin:0 0 14px 0;`;
const P = `font-size:15px;line-height:24px;color:#d9d0ee;margin:0 0 14px 0;`;
const SIGN = `font-size:15px;line-height:24px;color:#d9d0ee;margin:18px 0 0 0;`;

/** "Welcome to Liner" — fired the first time an account appears on the site. */
export function renderWelcomeEmail(
  input: WelcomeEmailInput,
): { subject: string; html: string; text: string } {
  const name = escapeHtml(emailDisplayName(input));
  const created = formatEmailDate(input.accountCreatedAt);
  const html = layout({
    bannerFile: "welcome-banner.jpg",
    bannerAlt: "Welcome — Liner",
    preheader: `Your Liner account is ready. Listen to your favorite music!`,
    innerHtml: `
<h1 style="${H1}">Welcome to Liner, ${name}!</h1>
<p style="${P}">Your account was created in <strong style="color:#ffffff;">${escapeHtml(created)}</strong>.</p>
<p style="${P}">Listen to your favorite music!</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px 0;"><tr><td style="border-radius:10px;background:#7c5cff;">
<a href="${MAIL_PUBLIC_BASE_URL}" target="_blank" style="${FONT}display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Open Liner</a>
</td></tr></table>
<p style="${SIGN}">Cheers mate!,</p>
<p style="font-size:15px;line-height:24px;color:#8f83ad;margin:2px 0 0 0;">- Liner System</p>`,
  });
  const text = [
    `Welcome to Liner, ${emailDisplayName(input)}!`,
    ``,
    `Your account was created in ${created}.`,
    ``,
    `Listen to your favorite music!`,
    ``,
    `${MAIL_PUBLIC_BASE_URL}`,
    ``,
    `Cheers mate!,`,
    `- Liner System`,
  ].join("\n");
  return {
    subject: `Welcome to Liner, ${emailDisplayName(input)}!`,
    html,
    text,
  };
}

/** "Your account was banned" — fired when the owner bans an account. */
export function renderBannedEmail(input: BannedEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const name = emailDisplayName(input);
  const reason = clean(input.reason, BAN_REASON_DISPLAY_MAX);
  const reasonText = reason || "No reason was provided.";
  const bannedAt = formatEmailDate(input.bannedAt);
  const expiresLine = input.expiresAt
    ? `\n<p style="${P}">This ban lifts on <strong style="color:#ffffff;">${escapeHtml(formatEmailDate(input.expiresAt))}</strong>.</p>`
    : "";
  const html = layout({
    bannerFile: "banned-banner.jpg",
    bannerAlt: "Banned — Liner",
    preheader: `Your Liner account was banned. If you think this was a mistake, contact JayJoice (cryptojay.eth).`,
    innerHtml: `
<h1 style="${H1}">Hello ${escapeHtml(name)},</h1>
<p style="${P}">Your account was banned due to reasons: <strong style="color:#ffffff;">${escapeHtml(reasonText)}</strong></p>
<p style="${P}">Date of banned: <strong style="color:#ffffff;">${escapeHtml(bannedAt)}</strong></p>${expiresLine}
<p style="${P}">If you think this was a mistake, contact <strong style="color:#ffffff;">JayJoice (cryptojay.eth)</strong> on Discord or email
<a href="mailto:${LINER_APPEAL_EMAIL}" style="color:#a78bfa;text-decoration:underline;">${LINER_APPEAL_EMAIL}</a>.</p>
<p style="${SIGN}">- Liner System</p>`,
  });
  const text = [
    `Hello ${name},`,
    ``,
    `Your account was banned due to reasons: ${reasonText}`,
    ``,
    `Date of banned: ${bannedAt}`,
    ...(input.expiresAt
      ? [``, `This ban lifts on ${formatEmailDate(input.expiresAt)}.`]
      : []),
    ``,
    `If you think this was a mistake, contact JayJoice (cryptojay.eth) on Discord or email ${LINER_APPEAL_EMAIL}.`,
    ``,
    `- Liner System`,
  ].join("\n");
  return {
    subject: `Your Liner account was banned`,
    html,
    text,
  };
}
