// One-off check: does the SMTP_* config in the gitignored .env authenticate?
// Uses nodemailer transport.verify() (connection + AUTH handshake, no mail sent).
// Never prints credentials — only host/port and the verdict.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync("/home/z/my-project/.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const prod = {};
for (const line of fs.readFileSync("/home/z/my-project/.env.production", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) prod[m[1]] = m[2].trim();
}
const host = env.SMTP_HOST || prod.SMTP_HOST;
const port = Number(env.SMTP_PORT || prod.SMTP_PORT || "465");
const user = env.SMTP_USER;
const pass = env.SMTP_PASS;
if (!host || !user || !pass) {
  console.error(`SMTP config incomplete — host: ${host ? "set" : "MISSING"}, user: ${user ? "set" : "MISSING"}, pass: ${pass ? "set" : "MISSING"}`);
  process.exit(1);
}
console.log(`verifying SMTP ${host}:${port} as ${user} (pass hidden) ...`);
const nodemailer = (await import("nodemailer")).default;
const t = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 20_000,
});
try {
  await t.verify();
  console.log("SMTP verify: OK — connection + auth accepted, no mail sent");
  process.exit(0);
} catch (e) {
  console.error("SMTP verify FAILED:", e.message);
  process.exit(2);
} finally {
  t.close();
}
