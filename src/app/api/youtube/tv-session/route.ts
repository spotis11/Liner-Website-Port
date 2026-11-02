// Server-side YouTube TV session bootstrap for the website port.
//
// Mirror of liner-ref/electron/youtube/tv-session.ts: the desktop fetches
// youtube.com/tv + tv_config in a hidden Electron window, solves the TV
// BotGuard challenge there and mints a living-room PO token. The server does
// the same directly (no CORS constraints) with the TV Cobalt user agent, and
// runs the challenge in a jsdom realm (see /api/po-token for the reasoning).
//
// GET /api/youtube/tv-session ->
//   { poToken, livingRoomPoTokenId, visitorData, clientVersion, playerId }

import { NextRequest } from "next/server";
import { JSDOM } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TV_USER_AGENT =
  "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)";
const TV_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
const YT_BASE = "https://www.youtube.com";

const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;

export interface TvSession {
  poToken: string;
  livingRoomPoTokenId: string;
  visitorData: string;
  clientVersion: string;
  playerId: string;
}

interface RawChallenge {
  interpreterUrl?: {
    privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string;
  };
  interpreterJavascript?: {
    privateDoNotAccessOrElseSafeScriptWrappedValue?: string;
  };
  program?: string;
  globalName?: string;
}

interface BotguardChallenge {
  program: string;
  globalName: string;
  interpreterUrl?: string;
  interpreterScript?: string;
}

interface MinterEntry {
  minter: WebPoMinter;
  expiresAt: number;
}

function capture(source: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(source)?.[1];
  if (!value) throw new Error(`YouTube TV page has no ${label}`);
  return value.replace(/\\u003d/g, "=");
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(`${YT_BASE}${path}`, {
    headers: { "user-agent": TV_USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

function readTvChallenge(config: string) {
  const requestKey = capture(
    config,
    /"challengeRequestKey":"(.*?)"/,
    "request key",
  );
  const params = /"challengeParams":\{"R":"(.*?[^\\])","T"/s.exec(config)?.[1];
  if (!params) throw new Error("YouTube TV config has no challenge");
  const raw = JSON.parse(JSON.parse(`{"r":"${params}"}`).r) as {
    bgChallenge?: RawChallenge;
  };
  const bg = raw.bgChallenge;
  const interpreterUrl =
    bg?.interpreterUrl
      ?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  const interpreterScript =
    bg?.interpreterJavascript
      ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!bg?.program || !bg.globalName || !(interpreterUrl || interpreterScript))
    throw new Error("YouTube TV BotGuard challenge is missing");
  return {
    requestKey,
    challenge: {
      program: bg.program,
      globalName: bg.globalName,
      ...(interpreterUrl ? { interpreterUrl } : {}),
      ...(interpreterScript ? { interpreterScript } : {}),
    } satisfies BotguardChallenge,
  };
}

async function generateTvIntegrityToken(
  requestKey: string,
  botguardResponse: string,
): Promise<{ token: string; ttlSeconds?: number }> {
  const response = await fetch(`${YT_BASE}/api/jnn/v1/GenerateIT`, {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": TV_API_KEY,
    },
    body: JSON.stringify([requestKey, botguardResponse]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`TV GenerateIT returned ${response.status}`);
  const [token, ttlSeconds] = (await response.json()) as [unknown, unknown];
  if (typeof token !== "string")
    throw new Error("TV GenerateIT returned no integrity token");
  return {
    token,
    ...(typeof ttlSeconds === "number" ? { ttlSeconds } : {}),
  };
}

async function createSession(): Promise<{
  session: TvSession;
  expiresAt: number;
}> {
  const [page, config] = await Promise.all([
    fetchText("/tv"),
    fetchText("/tv_config?action_get_config=true&client=lb4&theme=cl"),
  ]);
  const livingRoomPoTokenId = capture(
    page,
    /"LIVING_ROOM_PO_TOKEN_ID":"(.*?)"/,
    "living room id",
  );
  const visitorData = capture(page, /"visitorData":"(.*?)"/, "visitor data");
  const clientVersion = capture(
    page,
    /"INNERTUBE_CLIENT_VERSION":"(.*?)"/,
    "client version",
  );
  const playerId = capture(page, /\/s\/player\/([\w-]+)\//, "player id");
  const { requestKey, challenge } = readTvChallenge(config);

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://www.youtube.com/",
    userAgent: TV_USER_AGENT,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  try {
    const vmWindow = dom.window as unknown as typeof globalThis;
    if (challenge.interpreterScript) {
      vmWindow.eval(challenge.interpreterScript);
    } else {
      const response = await fetch(
        challenge.interpreterUrl?.startsWith("//")
          ? `https:${challenge.interpreterUrl}`
          : (challenge.interpreterUrl ?? ""),
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!response.ok)
        throw new Error(`interpreter download failed with ${response.status}`);
      vmWindow.eval(await response.text());
    }

    const botguard = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: vmWindow,
    });
    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
    const botguardResponse = (await botguard.snapshot({
      webPoSignalOutput,
    })) as unknown as string;

    const { token, ttlSeconds } = await generateTvIntegrityToken(
      requestKey,
      botguardResponse,
    );

    // re-export the VM-realm minter factory through Node-realm wrappers
    // (bgutils validates with Node-realm instanceof — see /api/po-token)
    const vmGetMinter = webPoSignalOutput[0] as unknown as (
      bytes: Uint8Array,
    ) => Promise<unknown>;
    if (typeof vmGetMinter !== "function")
      throw new Error("BotGuard produced no minter factory");
    webPoSignalOutput[0] = async (bytes: Uint8Array) => {
      const vmMintFn = (await vmGetMinter(bytes)) as unknown;
      if (typeof vmMintFn !== "function")
        throw new Error("BotGuard minter factory returned no mint function");
      return async (data: Uint8Array) => {
        const result = (await (
          vmMintFn as (data: Uint8Array) => Promise<unknown>
        )(data)) as unknown;
        return result instanceof Uint8Array
          ? result
          : new Uint8Array(result as Uint8Array<ArrayBufferLike>);
      };
    };

    const minter = await WebPoMinter.create(
      { integrityToken: token.replace(/\+/g, "-").replace(/\//g, "_") },
      webPoSignalOutput,
    );
    const poToken = await minter.mintAsWebsafeString(livingRoomPoTokenId);
    const ttlMs =
      (ttlSeconds && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS) * 1000;
    return {
      session: {
        poToken,
        livingRoomPoTokenId,
        visitorData,
        clientVersion,
        playerId,
      },
      expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 60_000),
    };
  } finally {
    dom.window.close();
  }
}

let current: { session: TvSession; expiresAt: number } | null = null;
let pending: Promise<{ session: TvSession; expiresAt: number }> | null = null;

async function getSession(): Promise<TvSession> {
  if (current && Date.now() < current.expiresAt) return current.session;
  pending ??= createSession()
    .then((next) => {
      current = next;
      return next;
    })
    .catch((error) => {
      current = null;
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return (await pending).session;
}

export async function GET(_request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  try {
    const session = await getSession();
    return Response.json(session, {
      headers: { "cache-control": "private, max-age=300" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "TV session bootstrap failed";
    console.error(
      "[tv-session] failed:",
      message,
      error instanceof Error ? `\n${error.stack}` : "",
    );
    return Response.json({ error: message }, { status: 502 });
  }
}
