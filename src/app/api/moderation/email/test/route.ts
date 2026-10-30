import { NextRequest, NextResponse } from "next/server";
import { authenticateAdmin, issueAdminCookie } from "@/lib/adminGate";
import { MODERATION_ADMIN_USERNAME } from "@/lib/moderation";
import { isValidEmailAddress, sendEmail } from "@/lib/mailer";
import {
  BAN_REASON_DISPLAY_MAX,
  LINER_APPEAL_EMAIL,
  renderBannedEmail,
  renderWelcomeEmail,
} from "@/lib/emailTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only mailer probe: send a sample welcome / banned mail to any
 * address so the owner can verify real delivery (sender identity, banners,
 * copy) without waiting for an actual signup or banning a real account.
 *
 * POST /api/moderation/email/test
 * body { accessToken, kind: "welcome" | "banned", to, username?, reason? }
 *
 * Test sends are NOT deduped or logged in EmailLog (a real welcome/ban mail
 * must never be blocked by a test) — they go straight through sendEmail and
 * report the provider's answer verbatim.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const accessToken =
    typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const auth = await authenticateAdmin(accessToken, req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const kind =
    body?.kind === "banned" || body?.kind === "welcome" ? body.kind : null;
  if (!kind) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  if (!isValidEmailAddress(to)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const username =
    typeof body?.username === "string" && body.username.trim()
      ? body.username.trim().slice(0, 30)
      : auth.username;
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, BAN_REASON_DISPLAY_MAX)
      : "Sample ban reason used by the /email/test probe";

  const content =
    kind === "welcome"
      ? renderWelcomeEmail({
          username,
          displayName: null,
          accountCreatedAt: new Date(),
        })
      : renderBannedEmail({
          username,
          displayName: null,
          reason,
          bannedAt: new Date(),
          expiresAt: null,
        });

  const result = await sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    // appeals always land in the owner's human inbox
    ...(kind === "banned" ? { replyTo: LINER_APPEAL_EMAIL } : {}),
  });

  const res = NextResponse.json({ result, kind, to });
  return issueAdminCookie(res, MODERATION_ADMIN_USERNAME);
}
