// Server-side YouTube PO token (Proof-of-Origin) minting for the web port.
//
// YouTube's WEB_REMIX (YT Music innertube) player requests require a PO token
// minted by running YouTube's BotGuard challenge. The desktop app mints inside
// a hidden Electron window; a browser page can't reliably do it (attestation
// is environment-sensitive), but BotGuard runs fine in Node — this is the
// standard bgutils-js server flow used across the youtube tooling ecosystem.
//
// The minter (challenge + integrity token) is cached ~6h; per-video minting is
// just a content-bound signature over the videoId afterwards.
//
// GET /api/po-token?videoId=<11-char id>  ->  { poToken: "..." }

import { NextRequest } from "next/server";
import { JSDOM } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, GOOG_API_KEY } from "bgutils-js/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const WEB_CLIENT_VERSION = "2.20250925.01.00";

const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const MINT_TIMEOUT_MS = 15_000;

interface BotguardChallenge {
  program: string;
  globalName: string;
  interpreterUrl?: string;
  interpreterScript?: string;
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

interface MinterEntry {
  minter: WebPoMinter;
  expiresAt: number;
}

/**
 * The browser sends the visitorData its innertube session uses (fetched from
 * sw.js_data on the user's IP). YouTube validates content-bound PO tokens
 * against the visitor session the BotGuard challenge ran in — a token minted
 * for visitor X but presented by visitor Y fails with "Sign in to confirm
 * you're not a bot". The desktop never had this split (its hidden Electron
 * window minted and played in the same session), so the web port must bind
 * the minter to the caller's visitorData.
 */
function isValidVisitorData(value: string | null): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512;
}

function readChallenge(raw: RawChallenge | undefined): BotguardChallenge {
  const interpreterUrl =
    raw?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  const interpreterScript =
    raw?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!raw?.program || !raw.globalName || !(interpreterUrl || interpreterScript))
    throw new Error("BotGuard challenge is missing");
  return {
    program: raw.program,
    globalName: raw.globalName,
    ...(interpreterUrl ? { interpreterUrl } : {}),
    ...(interpreterScript ? { interpreterScript } : {}),
  };
}

async function fetchWebChallenge(visitorData?: string): Promise<BotguardChallenge> {
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: WEB_CLIENT_VERSION,
            hl: "en",
            gl: "US",
            // binding the challenge to the caller's visitor session is what
            // makes the minted token valid for that session's player requests
            ...(visitorData ? { visitorData } : {}),
          },
        },
        engagementType: "ENGAGEMENT_TYPE_UNBOUND",
      }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`att/get returned ${response.status}`);
  const body = (await response.json()) as { bgChallenge?: RawChallenge };
  return readChallenge(body.bgChallenge);
}

async function loadInterpreter(challenge: BotguardChallenge): Promise<string> {
  if (challenge.interpreterScript) return challenge.interpreterScript;
  const url = challenge.interpreterUrl ?? "";
  const response = await fetch(url.startsWith("//") ? `https:${url}` : url, {
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`interpreter download failed with ${response.status}`);
  return response.text();
}

async function generateWebIntegrityToken(
  botguardResponse: string,
): Promise<{ token: string; ttlSeconds?: number }> {
  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GenerateIT returned ${response.status}`);
  const [token, ttlSeconds] = (await response.json()) as [
    string | null,
    number?,
  ];
  if (!token) throw new Error("GenerateIT returned no integrity token");
  return { token, ...(ttlSeconds ? { ttlSeconds } : {}) };
}

async function createMinterEntry(visitorData?: string): Promise<MinterEntry> {
  const challenge = await fetchWebChallenge(visitorData);

  // Run YouTube's interpreter VM inside a jsdom window: the VM attests
  // properly only in a browser-like realm (a bare Node realm mints nothing —
  // GenerateIT rejects the response). bgutils then validates the results with
  // Node-realm `instanceof`, so the VM-realm functions are re-exported through
  // Node-realm wrappers below.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://www.youtube.com/",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    pretendToBeVisual: true,
    // without this jsdom's window.eval runs code in a bare realm where even
    // window/document are undefined — the interpreter script needs the DOM
    runScripts: "outside-only",
  });
  try {
    const vmWindow = dom.window as unknown as typeof globalThis;
    vmWindow.eval(await loadInterpreter(challenge));

    const botguard = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: vmWindow,
    });
    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
    const botguardResponse = (await botguard.snapshot({
      webPoSignalOutput,
    })) as unknown as string;

    const { token, ttlSeconds } = await generateWebIntegrityToken(
      botguardResponse,
    );

    // the VM hands us a curried minter factory that lives in the jsdom realm;
    // re-expose both levels as Node-realm functions (see bgutils WebPoMinter:
    // getMinter must be `instanceof Function` and its result must be too, and
    // the minted bytes must be `instanceof Uint8Array` in this realm)
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
    const ttlMs =
      (ttlSeconds && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS) * 1000;
    return {
      minter,
      expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 60_000),
    };
  } finally {
    // release the DOM after minting; the wrapped mint functions still work —
    // they only close over the VM's crypto, not the document
    dom.window.close();
  }
}

// one minter per visitor session — the browser re-mints against its own
// visitorData, the legacy flow (no param) keeps its own entry
const MAX_MINTER_ENTRIES = 4;
const minters = new Map<string, MinterEntry>();
const pendings = new Map<string, Promise<MinterEntry>>();

function minterKey(visitorData?: string): string {
  return visitorData ?? "";
}

async function getMinter(visitorData?: string): Promise<MinterEntry> {
  const key = minterKey(visitorData);
  const cached = minters.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  pendings.set(
    key,
    (pendings.get(key) ?? createMinterEntry(visitorData))
      .then((entry) => {
        minters.set(key, entry);
        while (minters.size > MAX_MINTER_ENTRIES) {
          const oldest = minters.keys().next().value;
          if (oldest === undefined) break;
          minters.delete(oldest);
        }
        return entry;
      })
      .finally(() => {
        pendings.delete(key);
      }),
  );
  return pendings.get(key)!;
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId") ?? "";
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return Response.json(
      { error: "videoId must be an 11-character YouTube id" },
      { status: 400 },
    );
  }
  const visitorParam = request.nextUrl.searchParams.get("visitorData");
  const visitorData = isValidVisitorData(visitorParam) ? visitorParam : undefined;

  try {
    const { minter } = await getMinter(visitorData);
    const poToken = await minter.mintAsWebsafeString(videoId);
    if (!poToken)
      return Response.json(
        { error: "PO token minting returned an empty token" },
        { status: 502 },
      );
    // echo the binding back so the caller can pin its innertube session to
    // the exact visitor data this token was minted for
    return Response.json(
      { poToken, ...(visitorData ? { visitorData } : {}) },
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PO token minting failed";
    console.error(
      "[po-token] mint failed:",
      message,
      error instanceof Error ? `\n${error.stack}` : "",
    );
    return Response.json({ error: message }, { status: 502 });
  }
}
