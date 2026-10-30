/**
 * Real-world Resend probe: renders BOTH real transactional templates through
 * the real mailer code path and actually sends them via the Resend HTTPS API
 * (provider chain from src/lib/mailer.ts) to the given address.
 *
 * Run:  cd /home/z/my-project && set -a && . ./.env && set +a && \
 *       npx tsx --tsconfig tsconfig.json scripts/email_resend_probe.ts [to]
 *
 * Success per email looks like:
 *   resend-probe welcome {"ok":true,"provider":"resend","id":"..."}
 */
import {
  LINER_APPEAL_EMAIL,
  renderBannedEmail,
  renderWelcomeEmail,
} from "../src/lib/emailTemplates";
import { sendEmail } from "../src/lib/mailer";

const TO = process.argv[2] ?? "seekfromohio@gmail.com";

async function main() {
  const now = new Date();
  console.log("resend-probe from-mode:", process.env.MAIL_FROM ?? "(default)");
  console.log("resend-probe resend-key-present:", Boolean(process.env.RESEND_API_KEY));

  const welcome = renderWelcomeEmail({
    username: "goodbyeworld42",
    email: TO,
    createdAt: now,
  });
  const banned = renderBannedEmail({
    username: "goodbyeworld42",
    email: TO,
    reason: "Resend delivery probe - this is a test, not a real ban.",
    bannedAt: now,
  });

  const jobs = [
    { kind: "welcome" as const, mail: welcome },
    { kind: "banned" as const, mail: { ...banned, replyTo: LINER_APPEAL_EMAIL } },
  ];

  for (const { kind, mail } of jobs) {
    try {
      const res = await sendEmail({
        to: TO,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(kind === "banned" ? { replyTo: LINER_APPEAL_EMAIL } : {}),
      });
      console.log("resend-probe", kind, JSON.stringify(res));
    } catch (err) {
      console.log(
        "resend-probe",
        kind,
        JSON.stringify({ ok: false, error: String(err) }),
      );
    }
  }
}

main().catch((e) => {
  console.error("resend-probe fatal:", e);
  process.exit(1);
});
