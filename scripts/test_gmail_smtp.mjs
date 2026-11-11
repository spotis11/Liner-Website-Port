/**
 * One-shot Gmail SMTP verification for the Liner mailer credentials.
 *
 * Reads SMTP_* from /home/z/my-project/.env (never hardcodes secrets,
 * never prints them). Verifies the transport and, when asked, sends a
 * single test mail to the sender's own inbox (the owner's).
 *
 * Usage: node scripts/test_gmail_smtp.mjs [--send]
 *
 * Known caveat (worklog v1.17.0): from this sandbox's datacenter IP Google
 * may drop the connection at AUTH. A network-level drop is NOT a verdict on
 * the app password — production is the authoritative test.
 */
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

function loadEnv(path) {
  const out = {};
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — fall through */
  }
  return out;
}

const env = loadEnv("/home/z/my-project/.env");
const host = env.SMTP_HOST;
const port = Number(env.SMTP_PORT ?? "587");
const user = env.SMTP_USER;
const pass = env.SMTP_PASS;
const from = env.MAIL_FROM || `Liner <${user}>`;

if (!host || !user || !pass) {
  console.log(`config: host=${host ? "set" : "MISSING"} user=${user ? "set" : "MISSING"} pass=${pass ? "set" : "MISSING"}`);
  console.log("RESULT: not_configured");
  process.exit(0);
}
console.log(`config: host=${host} port=${port} user=${user} from="${from}" pass=<hidden, ${pass.length} chars>`);

const transport = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 20_000,
});

try {
  await transport.verify();
  console.log("VERIFY: ok — SMTP auth accepted, ready to send");
} catch (err) {
  const text = err && err.response ? String(err.response).slice(0, 160) : "";
  console.log(`VERIFY: FAILED — ${err && err.code ? err.code + " " : ""}${(err && err.message) || err}`.slice(0, 300));
  if (text) console.log(`server said: ${text}`);
  console.log("NOTE: a network-level drop (ECONNRESET/ETIMEDOUT at AUTH) from a datacenter IP is Google-side filtering, not a bad password.");
  process.exit(2);
}

if (process.argv.includes("--send")) {
  try {
    const info = await transport.sendMail({
      from,
      to: user,
      subject: "[Liner] SMTP test — the mailer is working",
      text: "This is a one-off test mail from the Liner website mailer. If you are reading this in your inbox, the Gmail app-password credentials in .env work and welcome/ban notification emails will now deliver.",
      html: `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;">This is a one-off test mail from the <b>Liner website mailer</b>.</p>
<p style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;">If you are reading this in your inbox, the Gmail app-password credentials in <code>.env</code> work — welcome and ban notification emails will now deliver from this address.</p>`,
    });
    console.log(`SEND: ok — messageId=${info.messageId}`);
  } catch (err) {
    console.log(`SEND: FAILED — ${(err && err.message) || err}`.slice(0, 300));
    process.exit(3);
  }
}
transport.close();
