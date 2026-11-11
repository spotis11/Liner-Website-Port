import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DISCORD_OAUTH_COOKIE,
  DISCORD_OAUTH_COOKIE_MAX_AGE,
  buildAuthorizeUrl,
  getDiscordConfig,
  getDiscordRedirectUri,
  mintChallenge,
  packOAuthCookie,
} from "@/lib/discordAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/discord/start — kick off the OAuth dance: mint the PKCE
 * challenge, remember it in a short-lived HttpOnly cookie, and redirect the
 * browser to Discord's authorize screen.
 */
export async function GET(req: NextRequest) {
  const config = getDiscordConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "Discord sign-in is not configured on this server.",
        code: "DISCORD_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const challenge = mintChallenge();
  const redirectUri = getDiscordRedirectUri(req);
  const authorizeUrl = buildAuthorizeUrl({ config, redirectUri, challenge });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set({
    name: DISCORD_OAUTH_COOKIE,
    value: packOAuthCookie(challenge),
    httpOnly: true,
    sameSite: "lax", // top-level GET navigation back from discord.com sends it
    secure: process.env.NODE_ENV === "production",
    maxAge: DISCORD_OAUTH_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
