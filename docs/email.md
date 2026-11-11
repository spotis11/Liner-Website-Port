# Liner System emails (no-reply mailer)

Real transactional email from the website, sender identity:

```
From: Liner System <linersystem22@gmail.com>
```

(Gmail only sends from the address it authenticated as, so the old
`no-reply@jayjoice.tryliner.fun` and Proton identities are retired. Set via
`MAIL_FROM` in `.env`.)

## When emails go out

| Mail | Trigger | Address source |
| --- | --- | --- |
| **Welcome** | The first time an account is ever verified on this website (its own signed-in session probes `/api/moderation/check`, which records it in `UserSeen`) | The account's own `/v1/me` payload (upstream) |
| **Banned** | The moment the site owner applies a ban (`POST /api/moderation/bans`) | The site's user cache (`UserSeen.email`), falling back to a live upstream directory lookup with the owner's token |

Both sends are fire-and-forget — a mailer failure can never break the ban
probe or the ban mutation. Every attempt is audited in the `EmailLog` table,
and the `(type, refKey)` unique pair is the dedupe contract:

- `welcome` → refKey = username → an account is welcomed **once, ever**
  (a FAILED attempt is retried until it succeeds)
- `banned` → refKey = ban row id → every **new** ban row mails again, retries never do

## Boot self-healing (v1.17.0)

`retryFailedTransactionalEmails()` runs 15 s after every server boot (wired
in `src/instrumentation.ts`, deferred + unref'd): it re-attempts every
`EmailLog` row that never landed — welcome mail rebuilt from the live
account, banned mail from the ban row. Once the SMTP credentials in `.env`
work, nothing that ever failed stays lost; only a "sent" row pins the dedupe
slot.

## Providers (first configured wins)

1. **Resend** — set `RESEND_API_KEY`. Currently DISABLED: the
   `jayjoice.tryliner.fun` domain was never verified on Resend, so every
   send failed 403. Re-enable only after domain verification.
2. **Gmail SMTP** (ACTIVE since v1.17.0) — set in `.env` (gitignored, never
   committed, never pushed):

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=linersystem22@gmail.com
   SMTP_PASS=<16-char Google App Password>
   MAIL_FROM=Liner System <linersystem22@gmail.com>
   MAIL_PUBLIC_BASE_URL=https://liner-music.space-z.ai
   ```

   **The SMTP password is NOT the Google login password** — Gmail rejects
   the login password with `535 5.7.8`. Generate an App Password at
   myaccount.google.com → Security → 2-Step Verification → **App passwords**
   (16 characters, shown once). Paste it (spaces stripped) as `SMTP_PASS`,
   then restart the server.

   Verified working on 2026-11-11 from the workspace sandbox: `verify()` +
   a real test send to the owner's own inbox both succeeded
   (`node scripts/test_gmail_smtp.mjs --send`).

   `MAIL_PUBLIC_BASE_URL` must stay on the real site domain — the welcome /
   ban mail HTML loads its banner images and the "Open Liner" button from
   there. The template default (`tryliner.fun`) is the upstream Liner
   service, not this site.

3. **Proton SMTP** (RETIRED) — the old `jayjoice@proton.me` identity: SMTP
   tokens need a paid Proton plan, every send failed `535` (audited in the
   production `emailLog`, including `thearchyexpunged`'s welcome mail). The
   v1.17.0 boot sweep delivered those stuck mails on the first boot with
   working credentials.
4. **Neither** → nothing is sent, `EmailLog` records `not_configured`.

## Credential hygiene (hard rule)

- Gmail credentials live **only** in `.env` (`.env*` is in `.gitignore`; the
  file is untracked and must stay that way).
- Never paste the app password into source, docs, tests, worklog, or commit
  messages. Scripts that need it read it from `.env` at runtime (see
  `scripts/test_gmail_smtp.mjs`) and never print it.
- If a credential ever lands in git history, treat it as burned: revoke the
  App Password in the Google account and generate a new one.

## Banner assets

`public/emails/welcome-banner.jpg` and `public/emails/banned-banner.jpg`
(the owner's uploaded banners, optimized) are served by the site and linked
by absolute URL from the mail HTML, so they render in every client.

## Templates

`src/lib/emailTemplates.ts` — dark table-based HTML + plain-text mirror,
inline styles only. Untrusted values (display names, ban reasons) are
HTML-escaped. Ban mails set `Reply-To: seekfromohio@gmail.com` so appeals
land in the owner's human inbox.

## Testing delivery without banning anyone

```
POST /api/moderation/email/test
{ "accessToken": "<owner token>", "kind": "welcome" | "banned",
  "to": "you@example.com", "username": "…", "reason": "…" }
```

Admin-gated (owner token / admin cookie, same gate as the bans API). Test
sends bypass the dedupe ledger on purpose.

Quick SMTP credentials check (reads `.env`, never prints secrets; `--send`
also mails one test message to the sender's own inbox):

```
node scripts/test_gmail_smtp.mjs [--send]
```

## Local end-to-end verification (no provider needed)

```
python3 scripts/smtp_catcher.py            # SMTP catcher on 127.0.0.1:1025
SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
  npx tsx --tsconfig tsconfig.json scripts/email_e2e_probe.ts
ls scripts/email-captures/                 # the .eml files it received
```

The probe exercises the real mailer path: both templates, the dedupe ledger
(second call reports `duplicate`), and invalid-address rejection.

## Ops notes

- `nodemailer` is a runtime dependency for the SMTP path and is copied into
  the standalone output explicitly (build script) — output file tracing
  misses it because the import is dynamic.
- EmailLog lives in the same SQLite db as bans; the self-healing DDL in
  `src/lib/db.ts` provisions it on boot.
