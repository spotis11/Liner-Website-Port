/**
 * One-shot Proton SMTP auth matrix: tries both hostnames on 465 (SSL) and
 * 587 (STARTTLS) and prints which (if any) accepts the credentials.
 *
 * Run:  cd /home/z/my-project && set -a && . ./.env && set +a && \
 *       npx tsx --tsconfig tsconfig.json scripts/email_smtp_auth_matrix.ts
 */
import nodemailer from "nodemailer";

const USER = process.env.SMTP_USER ?? "";
const PASS = process.env.SMTP_PASS ?? "";
const HOSTS = ["smtp.protonmail.ch", "mail.protonmail.ch"];
const PORTS = [465, 587];

async function main() {
  for (const host of HOSTS) {
    for (const port of PORTS) {
      const t = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user: USER, pass: PASS },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 15_000,
      });
      try {
        await t.verify();
        console.log(`AUTH-OK ${host}:${port}`);
        t.close();
        process.exit(0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`AUTH-FAIL ${host}:${port} :: ${msg.slice(0, 160)}`);
        t.close();
      }
    }
  }
  console.log("NO-COMBO-ACCEPTED");
}

main().catch((e) => {
  console.error("matrix fatal:", e);
  process.exit(1);
});
