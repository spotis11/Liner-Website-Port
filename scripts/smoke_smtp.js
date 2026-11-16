// One-shot SMTP credential check: verifies the Gmail app password via
// nodemailer's transport verify() — no mail is sent, nothing is printed
// except PASS/FAIL. Credentials come from the environment only; this file
// never contains them (hard rule: Google credentials are never stored).
const nodemailer = require("/home/z/my-project/node_modules/nodemailer");

(async () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.log("FAIL: SMTP_USER/SMTP_PASS not in environment");
    process.exit(2);
  }
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  try {
    await t.verify();
    console.log("PASS: SMTP credentials accepted by smtp.gmail.com:465");
  } catch (err) {
    console.log("FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
