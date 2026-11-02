# Liner System emails (no-reply mailer)

Real transactional email from the website, sender identity:

```
From: Liner <jayjoice@proton.me>
```

(Proton only sends from addresses that belong to the authenticated Proton
account, so the old `no-reply@jayjoice.tryliner.fun` identity is unused
while Proton is the provider.)

## When emails go out

| Mail | Trigger | Address source |
| --- | --- | --- |
| **Welcome** | The first time an account is ever verified on this website (its own signed-in session probes `/api/moderation/check`, which records it in `UserSeen`) | The account's own `/v1/me` payload (upstream) |
| **Banned** | The moment the site owner applies a ban (`POST /api/moderation/bans`) | The site's user cache (`UserSeen.email`), falling back to a live upstream directory lookup with the owner's token |

Both sends are fire-and-forget — a mailer failure can never break the ban
probe or the ban mutation. Every attempt is audited in the `EmailLog` table,
and the `(type, refKey)` unique pair is the dedupe contract:

- `welcome` → refKey = username → an account is welcomed **once, ever**
  (a FAILED attempt is retried on the next sighting until it succeeds)
- `banned` → refKey = ban row id → every **new** ban row mails again, retries never do

## Providers (first configured wins)

1. **Resend** — set `RESEND_API_KEY`. Currently DISABLED: the
   `jayjoice.tryliner.fun` domain was never verified on Resend, so every
   send failed 403. Re-enable only after domain verification.
2. **Proton SMTP** (ACTIVE) — set `SMTP_HOST=smtp.protonmail.ch`,
   `SMTP_PORT=465`, `SMTP_USER=jayjoice@proton.me`, `SMTP_PASS=<SMTP token>`,
   `MAIL_FROM="Liner <jayjoice@proton.me>"`.

   **The SMTP password is NOT the Proton login password** — Proton rejects
   it with `535 5.7.8` (verified on 465 + 587, both hostnames). Generate a
   token at mail.proton.me → Settings → All settings → Proton Mail →
   **SMTP tokens** → Create (pick the sending address when creating it).
   SMTP tokens require a paid Proton plan (Mail Plus / Unlimited /
   Business). Paste the token as `SMTP_PASS`, then restart the server.
3. **Neither** → nothing is sent, `EmailLog` records `not_configured`.

Optional overrides: `MAIL_PUBLIC_BASE_URL` (default `https://tryliner.fun`
— used for the banner images inside the mail body).

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
