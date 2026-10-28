// Task 34 repro harness: mirror the Liner WEB playback chain 1:1 against the
// local production server (:3000) — the exact path a browser takes — and
// compare with MODE=direct (desktop-equivalent, no proxy).
//
//   MODE=web    node task34_repro.mjs <videoIds...>   (browser path via :3000)
//   MODE=direct node task34_repro.mjs <videoIds...>   (desktop path, direct)
//   MODE=web    node task34_repro.mjs --search "query"  (find videoIds first)
//
// Chain mirrored:
//   1. visitorData  <- www.youtube.com/sw.js_data            (visitorSession.ts)
//   2. PO token     <- /api/po-token (server BotGuard mint)  (webRemixAudio.ts)
//   3. WEB_REMIX    <- music.youtube.com/youtubei via /api/yt       (youtubei.js YTMUSIC)
//   4. profiles     <- TVHTML5 / VISIONOS / ANDROID_VR via /api/yt/www (profileAudio.ts)
//   5. stream probe <- googlevideo range req via /api/media  (streamProbe.ts)

const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const MODE = process.env.MODE ?? "web";
const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------- rewriteForWeb mirror (liner-app/src/shared/lib/webProxy.ts) ----
const FETCH_HOSTS = [
  "soundcloud.com", "a-v2.sndcdn.com", "www.youtube.com", "youtube.com",
  "oauth2.googleapis.com", "api.deezer.com", "www.deezer.com",
  "api.music.apple.com", "music.apple.com", "open.spotify.com",
  "clienttoken.spotify.com", "api-partner.spotify.com", "open.spotifycdn.com",
  "api.genius.com", "genius.com", "images.genius.com", "api.github.com", "github.com",
];
const MEDIA_HOSTS = [
  "googlevideo.com", "sndcdn.com", "ytimg.com", "googleusercontent.com",
  "tryliner.fun", "tryliner.com", "r2.dev", "r2.cloudflarestorage.com",
  "amazonaws.com", "pinimg.com", "clstorage.net", "soundcloud.com",
];
function hostMatches(host, suffix) {
  return host === suffix || host.endsWith("." + suffix);
}
function rewriteForWeb(rawUrl) {
  if (!rawUrl) return rawUrl;
  if (rawUrl.startsWith("blob:") || rawUrl.startsWith("data:")) return rawUrl;
  let url;
  try { url = new URL(rawUrl); } catch { return rawUrl; }
  if (url.origin === ORIGIN) return rawUrl;
  const host = url.hostname;
  if (host === "api.tryliner.fun" || host === "api.tryliner.com") return rawUrl;
  if (hostMatches(host, "youtube.com") && url.pathname.startsWith("/youtubei/")) {
    const rest = `${url.pathname.slice("/youtubei".length)}${url.search}`;
    return host === "www.youtube.com" ? `${ORIGIN}/api/yt/www${rest}` : `${ORIGIN}/api/yt${rest}`;
  }
  if ((hostMatches(host, "youtube.com") || hostMatches(host, "googlevideo.com")) &&
      (url.pathname === "/api/manifest" || url.pathname.startsWith("/api/manifest/")))
    return `${ORIGIN}/api/yt/sabr?u=${encodeURIComponent(url.toString())}`;
  if (host === "api-v2.soundcloud.com") return `${ORIGIN}/api/sc${url.pathname}${url.search}`;
  if (hostMatches(host, "a-v2.sndcdn.com"))
    return `${ORIGIN}/api/fetch?u=${encodeURIComponent(url.toString())}`;
  if (MEDIA_HOSTS.some((s) => hostMatches(host, s)))
    return `${ORIGIN}/api/media?u=${encodeURIComponent(url.toString())}`;
  if (FETCH_HOSTS.some((s) => hostMatches(host, s)))
    return `${ORIGIN}/api/fetch?u=${encodeURIComponent(url.toString())}`;
  return rawUrl;
}

const realFetch = globalThis.fetch;
if (MODE === "web") {
  globalThis.fetch = async (input, init) => {
    if (typeof input === "string" || input instanceof URL) {
      const rewritten = rewriteForWeb(input.toString());
      if (rewritten === input.toString()) return realFetch(input, init);
      return realFetch(rewritten, init);
    }
    const rewritten = rewriteForWeb(input.url);
    if (rewritten === input.url) return realFetch(input, init);
    // mirror installWebFetchProxy: rebuild the Request at the rewritten URL
    const request = new Request(rewritten, input);
    return realFetch(request, init);
  };
}
const log = (...a) => console.log(...a);
const tag = `[${MODE}]`;

// ---------- visitorSession.ts mirror --------------------------------------
const VISITOR_DATA_PATTERN = /Cg[s-v][A-Za-z0-9_-]{20,}(?:%3D|=){0,2}/;
async function getClientVisitorData() {
  const res = await fetch("https://www.youtube.com/sw.js_data", {
    headers: { "user-agent": UA_BROWSER },
  });
  if (!res.ok) throw new Error(`sw.js_data returned ${res.status}`);
  const text = await res.text();
  return text.match(VISITOR_DATA_PATTERN)?.[0] ?? "";
}

// ---------- playbackProfiles.ts copy ---------------------------------------
const PROFILES = [
  {
    clientName: "TVHTML5", clientVersion: "7.20260707.07.00", clientIdHeader: "7",
    origin: "https://www.youtube.com", requiresJsPlayer: true,
    userAgent:
      "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
    includeUserAgentInContext: true,
  },
  {
    clientName: "VISIONOS", clientVersion: "1.02", clientIdHeader: "101",
    origin: "https://www.youtube.com",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    includeUserAgentInContext: true,
    extraContext: { osName: "visionOS", osVersion: "26.5.23O471", deviceMake: "Apple", deviceModel: "RealityDevice17,1" },
  },
  {
    clientName: "ANDROID_VR", clientVersion: "1.65.10", clientIdHeader: "28",
    origin: "https://www.youtube.com",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    includeUserAgentInContext: true,
    extraContext: { osName: "Android", osVersion: "12L", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32 },
  },
];

// ---------- innertubeClient.ts mirrors -------------------------------------
function buildClientContext(profile, visitorData) {
  return {
    clientName: profile.clientName, clientVersion: profile.clientVersion,
    hl: "en", gl: "US",
    ...(visitorData ? { visitorData } : {}),
    ...(profile.includeUserAgentInContext && profile.userAgent ? { userAgent: profile.userAgent } : {}),
    ...profile.extraContext,
  };
}
async function postPlayer(profile, videoId, signatureTimestamp) {
  const visitorData = await getClientVisitorData().catch(() => "");
  const url = `${profile.origin}/youtubei/v1/player?prettyPrint=false`;
  const headers = {
    "content-type": "application/json", accept: "application/json",
    "x-youtube-client-name": profile.clientIdHeader,
    "x-youtube-client-version": profile.clientVersion,
    "x-origin": profile.origin,
    ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
    ...(profile.userAgent ? { "x-liner-user-agent": profile.userAgent } : {}),
  };
  const payload = {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    ...(signatureTimestamp
      ? { playbackContext: { contentPlaybackContext: { signatureTimestamp } } }
      : {}),
    context: { client: buildClientContext(profile, visitorData), user: { lockedSafetyMode: false } },
  };
  return fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
}

// ---------- streamProbe.ts mirror ------------------------------------------
async function probeStream(url) {
  const probe = new URL(url);
  probe.searchParams.set("range", "0-0");
  const response = await fetch(probe.toString());
  await response.body?.cancel().catch(() => undefined);
  return { status: response.status, ok: response.ok };
}

// ---------- WEB_REMIX (webRemixAudio.ts mirror, via youtubei.js) -----------
let innertubePromise = null;
async function getInnertube(visitorData) {
  const { Innertube } = await import("youtubei.js");
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      visitor_data: visitorData,
      user_agent: UA_BROWSER,
      generate_session_locally: true,
      retrieve_player: true,
      fetch: (input, init) => fetch(input, init),
    });
    innertubePromise.catch(() => { innertubePromise = null; });
  }
  return innertubePromise;
}

async function webRemixResolve(videoId, visitorData, poToken) {
  const innertube = await getInnertube(visitorData);
  const info = await innertube.getBasicInfo(videoId, { client: "YTMUSIC", po_token: poToken });
  const bi = info.basic_info ?? {};
  log(`  identity: "${bi.title}" by ${bi.author ?? "?"} (duration ${bi.duration ?? "?"}s, channel ${bi.channel_id ?? "?"})`);
  const status = info.playability_status?.status;
  const reason = info.playability_status?.reason;
  log(`  WEB_REMIX playability: ${status}${reason ? ` (${reason})` : ""}`);
  if (status !== "OK") return { stage: "playability", status, reason };
  const audioFormats = (info.streaming_data?.adaptive_formats ?? []).filter(
    (f) => f.has_audio && !f.has_video && String(f.mime_type).startsWith("audio/"),
  );
  log(`  WEB_REMIX audio formats: ${audioFormats.length}`);
  if (audioFormats.length === 0) return { stage: "formats", status };
  const source = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  const deciphered = await source.decipher(innertube.session.player);
  const url = new URL(deciphered);
  url.searchParams.set("pot", poToken);
  const probe = await probeStream(url.toString());
  log(`  WEB_REMIX stream probe: ${probe.status}`);
  return { stage: probe.ok ? "ok" : "probe", status, probeStatus: probe.status, url: url.toString().slice(0, 80) };
}

// ---------- profile chain (profileAudio.ts mirror) --------------------------
function audioFormatsFrom(playerResponse) {
  const sd = playerResponse?.streamingData;
  return (sd?.adaptiveFormats ?? [])
    .filter((f) => (f.mimeType ?? f.mime_type ?? "").startsWith("audio/") && !f.hasVideo && !f.has_video)
    .map((f) => ({
      itag: f.itag,
      url: f.url,
      signatureCipher: f.signatureCipher ?? f.cipher,
      mimeType: f.mimeType ?? f.mime_type,
      bitrate: f.bitrate ?? f.averageBitrate ?? 0,
      contentLength: Number(f.contentLength ?? f.content_length ?? 0),
    }));
}
function playabilityOf(playerResponse) {
  const s = playerResponse?.playabilityStatus;
  return { status: s?.status ?? "MISSING", reason: s?.reason ?? "" };
}

async function profileResolve(videoId, profile, signatureTimestamp) {
  let response = await (await postPlayer(profile, videoId, profile.requiresJsPlayer ? signatureTimestamp : null)).json();
  let { status, reason } = playabilityOf(response);
  if (status === "LOGIN_REQUIRED") {
    // requiresBotCheck path: resetClientVisitorData + one retry (harness has no cache — retry is a no-op re-request)
    response = await (await postPlayer(profile, videoId, profile.requiresJsPlayer ? signatureTimestamp : null)).json();
    ({ status, reason } = playabilityOf(response));
  }
  if (status !== "OK") return { stage: "playability", status, reason };
  const formats = audioFormatsFrom(response).filter((f) => !profile.requiresJsPlayer || f.url || f.signatureCipher);
  log(`  ${profile.clientName} audio formats: ${formats.length}`);
  if (formats.length === 0) return { stage: "formats", status };
  const best = formats.sort((a, b) => b.bitrate - a.bitrate)[0];
  let url = best.url;
  if (profile.requiresJsPlayer && !url) {
    const { Innertube } = await import("youtubei.js");
    const innertube = await innertubePromise ?? await getInnertube(await getClientVisitorData());
    url = await innertube.session.player.decipher(best.url || undefined, best.signatureCipher);
  }
  const probe = await probeStream(url);
  log(`  ${profile.clientName} stream probe: ${probe.status}`);
  return { stage: probe.ok ? "ok" : "probe", status, probeStatus: probe.status };
}

// ---------- main ------------------------------------------------------------
async function resolveVideoId(videoId) {
  log(`\n=== ${videoId} [${MODE}] ===`);
  const visitorData = await getClientVisitorData();
  log(`  visitorData: ${visitorData ? visitorData.slice(0, 16) + "..." : "(empty)"}`);

  // 1. PO token (server mint, exactly like webRemixAudio.mintContentPoToken)
  let poToken = "";
  try {
    const u = new URL(`${ORIGIN}/api/po-token`);
    u.searchParams.set("videoId", videoId);
    if (visitorData) u.searchParams.set("visitorData", visitorData);
    const res = await realFetch(u, { signal: AbortSignal.timeout(25000) });
    const body = await res.json();
    poToken = body.poToken ?? "";
    log(`  po-token: ${res.status} ${poToken ? "(" + poToken.slice(0, 12) + "...)" : JSON.stringify(body).slice(0, 120)}`);
  } catch (e) {
    log(`  po-token FAILED: ${String(e).slice(0, 120)}`);
  }

  // 2. WEB_REMIX
  try {
    if (poToken) await webRemixResolve(videoId, visitorData, poToken);
    else log("  WEB_REMIX skipped (no po token)");
  } catch (e) {
    log(`  WEB_REMIX threw: ${String(e).slice(0, 200)}`);
  }

  // 3. Profiles (TV first — requires the WEB_REMIX session player for sig ts)
  let signatureTimestamp = null;
  try {
    const innertube = await getInnertube(visitorData);
    signatureTimestamp = innertube.session.player?.signature_timestamp ?? null;
    log(`  signatureTimestamp: ${signatureTimestamp}`);
  } catch { /* stays null */ }
  for (const profile of PROFILES) {
    try {
      const r = await profileResolve(videoId, profile, signatureTimestamp);
      log(`  ${profile.clientName}: ${JSON.stringify(r)}`);
    } catch (e) {
      log(`  ${profile.clientName} threw: ${String(e).slice(0, 160)}`);
    }
  }
}

async function searchYT(query) {
  log(`\n=== search "${query}" [${MODE}] ===`);
  const visitorData = await getClientVisitorData();
  const innertube = await getInnertube(visitorData);
  const res = await innertube.music.search(query);
  // generic deep walk: collect every musicResponsiveListItemRenderer /
  // videoRenderer-ish node with a videoId + title + subtitle runs
  const rows = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
    seen.add(node);
    const id = node.videoId ?? node.playlistItemData?.videoId;
    if (typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      const cols = node.flexColumns ?? [];
      const runText = (col) =>
        col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
          ?.map((r) => r.text)
          .join("") ?? "";
      const title = node.title?.simpleText ?? node.title?.runs?.[0]?.text ?? runText(cols[0]);
      const subtitle = runText(cols[1]) || node.shortBylineText?.runs?.[0]?.text || "";
      rows.push(`${id} | ${title} | ${subtitle.slice(0, 90)}`);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
      else if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  walk(res, 0);
  if (rows.length === 0) log("  (no rows found)");
  for (const row of rows.slice(0, 8)) log("  " + row);
}

const args = process.argv.slice(2);
if (args[0] === "--search") {
  for (const q of args.slice(1)) await searchYT(q);
} else {
  for (const id of args) await resolveVideoId(id);
}
