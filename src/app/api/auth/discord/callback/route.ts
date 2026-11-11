import { NextRequest, NextResponse } from "next/server";
import {
  DISCORD_OAUTH_COOKIE,
  DiscordOAuthError,
  exchangeDiscordCode,
  fetchDiscordProfile,
  getDiscordConfig,
  getDiscordPublicBase,
  getDiscordRedirectUri,
  unpackOAuthCookie,
} from "@/lib/discordAuth";
import { loginWithDiscord, toPublicUser } from "@/lib/websiteAuth";
import { issueWebsiteOwnerCookie } from "@/lib/websiteCookie";
import { scheduleDbMirror } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/discord/callback — finish the OAuth dance: verify the state
 * cookie, exchange the code (PKCE), load the Discord profile, sign in /
 * auto-link / auto-create the website account, and redirect back to the SPA
 * with the session in the URL FRAGMENT (#… — never sent to any server,
 * cleared by the SPA as soon as it is consumed).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = getDiscordPublicBase(req);

  const backToSpa = (fragmentParams: string, clearCookie: boolean) => {
    const response = NextResponse.redirect(
      `${base}/#/auth/discord?${fragmentParams}`,
    );
    if (clearCookie) {
      response.cookies.set({
        name: DISCORD_OAUTH_COOKIE,
        value: "",
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
    }
    return response;
  };

  const fail = (error: string) => backToSpa(`error=${encodeURIComponent(error)}`, true);

  const config = getDiscordConfig();
  if (!config) return fail("not_configured");

  // Discord may bounce back with an OAuth error (user pressed Cancel, etc.)
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    console.warn("[auth/discord] authorize error:", oauthError);
    return fail(oauthError === "access_denied" ? "denied" : oauthError);
  }

  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");

  const cookie = unpackOAuthCookie(req.cookies.get(DISCORD_OAUTH_COOKIE)?.value);
  if (!cookie) return fail("expired");
  if (url.searchParams.get("state") !== cookie.state) {
    return fail("state_mismatch");
  }

  try {
    const tokens = await exchangeDiscordCode({
      config,
      code,
      redirectUri: getDiscordRedirectUri(req),
      verifier: cookie.verifier,
    });
    const profile = await fetchDiscordProfile(tokens.accessToken, config.apiBase);

    const { account, session } = await loginWithDiscord(
      profile,
      req.headers.get("user-agent"),
    );

    scheduleDbMirror();

    const user = toPublicUser(account);
    const params = new URLSearchParams({
      at: session.accessToken,
      rt: session.refreshToken,
      exp: session.accessTokenExpiresAt,
      user: Buffer.from(JSON.stringify(user)).toString("base64url"),
    });
    const response = backToSpa(params.toString(), true);
    issueWebsiteOwnerCookie(response, account.id, account.username);
    return response;
  } catch (error) {
    if (error instanceof DiscordOAuthError) {
      console.error("[auth/discord]", error.code, error.message);
    } else {
      console.error("[auth/discord] unexpected:", error);
    }
    return fail("server_error");
  }
}
