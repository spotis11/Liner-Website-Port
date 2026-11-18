import { Innertube, Platform } from "youtubei.js/web";
import { getClientVisitorData } from "../session/visitorSession";
import { InnertubeError } from "./innertubeClient";
import {
  selectBestAudioFormat,
  toResolvedStream,
  type AudioFormat,
  type ResolvedAudioStream,
} from "./innertubeAudioFormats";

interface WebRemixSession {
  visitorData: string;
  innertube: Innertube;
}

let sessionPromise: Promise<WebRemixSession> | null = null;
let evaluatorInstalled = false;

function installPlayerEvaluator(): void {
  if (evaluatorInstalled) return;
  Platform.shim.eval = async (data, env) => {
    const args = [env.n, env.sp, env.sig].map((value) =>
      JSON.stringify(value ?? ""),
    );
    return new Function(
      `${data.output}\nreturn process(${args.join(", ")});`,
    )();
  };
  evaluatorInstalled = true;
}

async function createSession(visitorData: string): Promise<WebRemixSession> {
  const innertube = await Innertube.create({
    visitor_data: visitorData,
    user_agent: navigator.userAgent,
    generate_session_locally: true,
    retrieve_player: true,
    fetch: (input, init) => fetch(input, init),
  });
  return { visitorData, innertube };
}

async function getSession(visitorData: string): Promise<WebRemixSession> {
  const existing = sessionPromise
    ? await sessionPromise.catch(() => null)
    : null;
  if (existing && existing.visitorData === visitorData) return existing;
  sessionPromise = createSession(visitorData);
  sessionPromise.catch(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

export function resetWebRemixSession(): void {
  sessionPromise = null;
}

export type WebPlayer = NonNullable<Innertube["session"]["player"]>;

export async function getWebPlayer(): Promise<WebPlayer> {
  installPlayerEvaluator();
  const { innertube } = await getSession(await getClientVisitorData());
  const player = innertube.session.player;
  if (!player)
    throw new InnertubeError("YouTube player script is unavailable.", 502);
  return player;
}

async function mintContentPoToken(
  videoId: string,
  visitorData: string,
): Promise<{ poToken: string; visitorData: string }> {
  // desktop: the native signer mints in a hidden Electron window (same
  // visitor session as playback — always consistent).
  // website port: the shell mints server-side (BotGuard in a jsdom realm —
  // see src/app/api/po-token/route.ts) and hands the token back here. The
  // mint must be bound to THIS browser's visitorData: YouTube validates a
  // content-bound PO token against the visitor session that ran BotGuard, so
  // a token minted for a foreign session fails with "Sign in to confirm
  // you're not a bot". The route echoes the binding back; the session below
  // pins to it.
  const mint =
    typeof window === "undefined"
      ? undefined
      : window.linerElectron?.mintPoToken;
  if (mint) {
    const token = await mint(videoId);
    return { poToken: token, visitorData };
  }
  const params = new URLSearchParams({ videoId });
  if (visitorData) params.set("visitorData", visitorData);
  const response = await fetch(`/api/po-token?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new InnertubeError(
      body?.error || `PO token request failed (${response.status})`,
      502,
    );
  }
  const body = (await response.json()) as {
    poToken?: string;
    visitorData?: string;
  };
  if (!body.poToken)
    throw new InnertubeError("PO token minting returned an empty token", 502);
  // trust the server's echo: it is the session the token is actually valid for
  return {
    poToken: body.poToken,
    visitorData: body.visitorData || visitorData,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

export async function resolveWebRemixAudioStream(
  videoId: string,
  options: { signal?: AbortSignal; preferredCodec?: "opus" | "aac" } = {},
): Promise<ResolvedAudioStream> {
  installPlayerEvaluator();
  // visitorData FIRST, then mint bound to it — the pair must describe the
  // same visitor session or YouTube bot-checks the player request
  const browserVisitorData = await getClientVisitorData();
  throwIfAborted(options.signal);
  const { poToken, visitorData } = await mintContentPoToken(
    videoId,
    browserVisitorData,
  );
  throwIfAborted(options.signal);
  const { innertube } = await getSession(visitorData);
  throwIfAborted(options.signal);
  const info = await innertube.getBasicInfo(videoId, {
    client: "YTMUSIC",
    po_token: poToken,
  });
  throwIfAborted(options.signal);
  const status = info.playability_status?.status;
  if (status !== "OK")
    throw new InnertubeError(
      info.playability_status?.reason || `WEB_REMIX: ${status}`,
      403,
    );

  const audioFormats = (info.streaming_data?.adaptive_formats ?? []).filter(
    (format) =>
      format.has_audio &&
      !format.has_video &&
      format.mime_type.startsWith("audio/"),
  );
  const candidates: AudioFormat[] = audioFormats.map((format) => ({
    itag: format.itag,
    url: "",
    mimeType: format.mime_type,
    bitrate: format.bitrate || format.average_bitrate || 0,
    ...(Number(format.content_length) > 0
      ? { contentLength: Number(format.content_length) }
      : {}),
  }));
  const best = selectBestAudioFormat(candidates, options.preferredCodec);
  const source = best
    ? audioFormats.find((format) => format.itag === best.itag)
    : undefined;
  if (!best || !source)
    throw new InnertubeError("WEB_REMIX returned no audio formats.", 502);

  const deciphered = await source.decipher(innertube.session.player);
  throwIfAborted(options.signal);
  const url = new URL(deciphered);
  url.searchParams.set("pot", poToken);
  return toResolvedStream({ ...best, url: url.toString() });
}
