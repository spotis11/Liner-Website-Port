/**
 * End-to-end verification of the Liner mailer against a local SMTP catcher:
 * renders BOTH real templates through the real mailer code path (dedupe
 * ledger included) and ships them over real SMTP to 127.0.0.1:1025.
 * Also writes the rendered HTML bodies to download/ as visual previews.
 */
import { mkdirSync, writeFileSync } from "fs";
import { deliverBannedEmail, deliverWelcomeEmail, sendEmail } from "../src/lib/mailer";
import {
  MAIL_FROM,
  renderBannedEmail,
  renderWelcomeEmail,
} from "../src/lib/emailTemplates";

async function main() {
  const now = new Date();
  const previewDir = "/home/z/my-project/download/email-previews";
  mkdirSync(previewDir, { recursive: true });

  const welcome = renderWelcomeEmail({
    username: "starmoss",
    displayName: "Star",
    accountCreatedAt: now,
  });
  const banned = renderBannedEmail({
    username: "starmoss",
    displayName: "Star",
    reason: "Cheating with an aim-bot <script>alert('xss')</script> & other stuff that is quite long to test the wrapping behavior of the layout in email clients",
    bannedAt: now,
    expiresAt: null,
  });

  writeFileSync(`${previewDir}/welcome.html`, welcome.html);
  writeFileSync(`${previewDir}/banned.html`, banned.html);
  console.log("[probe] from:", MAIL_FROM);
  console.log("[probe] welcome subject:", welcome.subject);
  console.log("[probe] banned subject:", banned.subject);

  // 1. plain sendEmail path (no dedupe)
  const direct = await sendEmail({
    to: "catch@localhost.test",
    subject: welcome.subject,
    html: welcome.html,
    text: welcome.text,
  });
  console.log("[probe] direct welcome send:", JSON.stringify(direct));

  // 2. deduped transactional path — welcome once, banned once, then repeats
  const w1 = await deliverWelcomeEmail({
    username: "starmoss",
    displayName: "Star",
    email: "catch@localhost.test",
    accountCreatedAt: now,
  });
  const w2 = await deliverWelcomeEmail({
    username: "starmoss",
    displayName: "Star",
    email: "catch@localhost.test",
    accountCreatedAt: now,
  });
  const b1 = await deliverBannedEmail({
    username: "starmoss",
    displayName: "Star",
    reason: "Sample ban reason",
    bannedAt: now,
    expiresAt: null,
    email: "catch@localhost.test",
    banId: "ban-test-0001",
  });
  const b2 = await deliverBannedEmail({
    username: "starmoss",
    displayName: "Star",
    reason: "Sample ban reason",
    bannedAt: now,
    expiresAt: null,
    email: "catch@localhost.test",
    banId: "ban-test-0001",
  });
  console.log("[probe] welcome #1:", JSON.stringify(w1));
  console.log("[probe] welcome #2 (must be duplicate):", JSON.stringify(w2));
  console.log("[probe] banned #1:", JSON.stringify(b1));
  console.log("[probe] banned #2 (must be duplicate):", JSON.stringify(b2));

  // 3. invalid address must be rejected
  const bad = await deliverWelcomeEmail({
    username: "starmoss",
    email: "not-an-email",
    accountCreatedAt: now,
  });
  console.log("[probe] invalid address:", JSON.stringify(bad));

  process.exit(0);
}

main().catch((err) => {
  console.error("[probe] failed:", err);
  process.exit(1);
});
