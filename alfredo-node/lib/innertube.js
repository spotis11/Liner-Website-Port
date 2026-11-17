// Alfredo stream resolver — Node edition.
// Ported from the liner-app InnerTube audio stack (tryliner/desktop) and
// alfredo.py's yt-dlp fallback:
//   1. InnerTube device profiles (VISIONOS → ANDROID_VR → IOS → ANDROID_MUSIC)
//      return plain `url` audio formats with no PO token and no JS decipher —
//      these are NOT throttled to 1 MB on datacenter egress (the bug that
//      broke .playmusic with plain yt-dlp).
//   2. yt-dlp (-J) fallback for anything the profiles refuse.
// The resolved URL is bound to the profile's User-Agent: callers MUST send the
// same UA when streaming (see music.js ffmpeg args).
"use strict";

const { execFile } = require("child_process");
const fs = require("fs");

// YouTube cookies (Netscape format) arrive base64-encoded in the YT_COOKIES
// env var so they never live in the source tree, git, or logs. Decoded once
// at boot into a private 0600 file, passed to every yt-dlp call below.
const COOKIE_PATH = "/tmp/.alfredo/yt-cookies.txt";
let cookieReady = false;
(function initCookies() {
  try {
    const b64 = process.env.YT_COOKIES;
    if (!b64) return;
    fs.mkdirSync("/tmp/.alfredo", { recursive: true, mode: 0o700 });
    fs.writeFileSync(COOKIE_PATH, Buffer.from(b64, "base64"), { mode: 0o600 });
    cookieReady = true;
    log(`yt cookies loaded (${b64.length} b64 chars)`);
  } catch (e) {
    log("yt cookies bootstrap failed:", e.message);
  }
})();
function ytCookieArgs() {
  return cookieReady ? ["--cookies", COOKIE_PATH] : [];
}

const INNERTUBE_TIMEOUT_MS = 12000;
const PREFERRED_ITAGS = [251, 140, 250, 249, 139];

// Client definitions adapted from liner-app/src/shared/youtube/innertube/playbackProfiles.ts
// (TVHTML5 skipped: it requires the web JS player for signature deciphering).
const PROFILES = [
  {
    name: "VISIONOS",
    version: "1.02",
    id: "101",
    origin: "https://www.youtube.com",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    extra: { osName: "visionOS", osVersion: "26.5.23O471", deviceMake: "Apple", deviceModel: "RealityDevice17,1" },
  },
  {
    name: "ANDROID_VR",
    version: "1.65.10",
    id: "28",
    origin: "https://www.youtube.com",
    ua: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    extra: { osName: "Android", osVersion: "12L", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32 },
  },
  {
    name: "IOS",
    version: "20.10.4",
    id: "5",
    origin: "https://www.youtube.com",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    extra: { osName: "iOS", osVersion: "18.3.2.22D60", deviceMake: "Apple", deviceModel: "iPhone16,2" },
  },
  {
    name: "ANDROID_MUSIC",
    version: "7.27.52",
    id: "21",
    origin: "https://music.youtube.com",
    ua: "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US) gzip",
    extra: { androidSdkVersion: 34 },
  },
];

function log(...parts) {
  console.log(`[resolver] ${new Date().toISOString()}`, ...parts);
}

// ---------------------------------------------------------------------------
// Visitor session — ported from liner-app visitorSession.ts/visitorData.ts.
// YouTube hands LOGIN_REQUIRED (bot check) to profile players that omit
// visitorData; a fresh token from sw.js_data (cached 5.5h) fixes it.
// ---------------------------------------------------------------------------
const VISITOR_DATA_PATTERN = /Cg[s-v][A-Za-z0-9_-]{20,}(?:%3D|=){0,2}/;
const SESSION_TTL_MS = 5.5 * 60 * 60 * 1000;
const SESSION_FAILURE_COOLDOWN_MS = 60 * 1000;

let cachedVisitor = null;
let pendingVisitorFetch = null;
let visitorFailedAt = 0;

function resetVisitorSession() {
  cachedVisitor = null;
  visitorFailedAt = 0;
}

function parseVisitorData(text) {
  const body = text.startsWith(")]}'") ? text.slice(text.indexOf("\n") + 1) : text;
  try {
    // sw.js_data JSON path: [0][2][0][0][13] holds the visitor token
    let v = JSON.parse(body);
    for (const idx of [0, 2, 0, 0]) v = v?.[idx];
    const candidate = v?.[13];
    if (typeof candidate === "string" && VISITOR_DATA_PATTERN.test(candidate)) return candidate;
  } catch {}
  const m = body.match(VISITOR_DATA_PATTERN);
  return m ? m[0] : null;
}

function getVisitorData() {
  const now = Date.now();
  if (cachedVisitor && cachedVisitor.expiresAt > now) return Promise.resolve(cachedVisitor.visitorData);
  if (pendingVisitorFetch) return pendingVisitorFetch;
  if (now - visitorFailedAt < SESSION_FAILURE_COOLDOWN_MS) return Promise.resolve(cachedVisitor?.visitorData || "");
  pendingVisitorFetch = (async () => {
    try {
      const resp = await fetch("https://www.youtube.com/sw.js_data", {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error(`sw.js_data HTTP ${resp.status}`);
      const visitorData = parseVisitorData(await resp.text());
      if (!visitorData) throw new Error("no visitorData in sw.js_data");
      cachedVisitor = { visitorData, expiresAt: Date.now() + SESSION_TTL_MS };
      log(`visitor session ready: ${visitorData.slice(0, 16)}...`);
      return visitorData;
    } catch (err) {
      visitorFailedAt = Date.now();
      log("visitor session fetch failed:", err.message);
      return cachedVisitor?.visitorData || "";
    } finally {
      pendingVisitorFetch = null;
    }
  })();
  return pendingVisitorFetch;
}

async function postPlayer(videoId, profile) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INNERTUBE_TIMEOUT_MS);
  try {
    const visitorData = await getVisitorData();
    const body = {
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      context: {
        client: {
          clientName: profile.name,
          clientVersion: profile.version,
          hl: "en",
          gl: "US",
          ...(visitorData ? { visitorData } : {}),
          ...(profile.ua ? { userAgent: profile.ua } : {}),
          ...profile.extra,
        },
        user: { lockedSafetyMode: false },
      },
    };
    const resp = await fetch(`${profile.origin}/youtubei/v1/player?prettyPrint=false`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-youtube-client-name": profile.id,
        "x-youtube-client-version": profile.version,
        "x-origin": profile.origin,
        ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
        "user-agent": profile.ua,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function audioFormats(playerResponse) {
  const adaptive = playerResponse?.streamingData?.adaptiveFormats;
  if (!Array.isArray(adaptive)) return [];
  const out = [];
  for (const f of adaptive) {
    if (!f || typeof f.itag !== "number") continue;
    if (typeof f.mimeType !== "string" || !f.mimeType.startsWith("audio/")) continue;
    if (typeof f.url !== "string" || !f.url) continue; // device profiles give plain urls; ciphers are useless without the web player
    out.push({
      itag: f.itag,
      url: f.url,
      mimeType: f.mimeType,
      bitrate: typeof f.bitrate === "number" ? f.bitrate : Number(f.averageBitrate) || 0,
      contentLength: Number(f.contentLength) || 0,
    });
  }
  return out;
}

// Reachability probe: googlevideo refuses datacenter IPs per-client — a
// 2-byte ranged GET with the SAME UA proves the URL streams before we commit
// ffmpeg. A content-length under ~1MB on a full audio itag is the classic
// 403-truncation signature, treated as a refusal.
async function assertStreamReachable(url, ua, contentLength) {
  const resp = await fetch(url, {
    headers: { "user-agent": ua, range: "bytes=0-1" },
    signal: AbortSignal.timeout(10000),
  });
  await resp.body?.cancel().catch(() => {});
  if (!resp.ok) throw new Error(`probe HTTP ${resp.status}`);
  const cr = resp.headers.get("content-range");
  const total = cr ? Number(String(cr).split("/")[1]) : NaN;
  if (Number.isFinite(total) && total > 0 && total < 100_000) {
    throw new Error(`probe truncation signature (total=${total})`);
  }
  if (!Number.isFinite(total) && contentLength && contentLength < 100_000) {
    throw new Error(`truncation signature (cl=${contentLength})`);
  }
}

async function innertubeResolve(videoId) {
  const failures = [];
  for (const profile of PROFILES) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const pr = await postPlayer(videoId, profile);
        const status = pr?.playabilityStatus?.status;
        if (status === "LOGIN_REQUIRED") {
          // bot check — fresh visitorData and retry once (profileAudio.ts pattern)
          if (attempt === 0) {
            resetVisitorSession();
            continue;
          }
          throw new Error("playability LOGIN_REQUIRED");
        }
        if (status && status !== "OK") throw new Error(`playability ${status}`);
        const formats = audioFormats(pr);
        let best = null;
        for (const itag of PREFERRED_ITAGS) {
          best = formats.find((f) => f.itag === itag);
          if (best) break;
        }
        if (!best) best = formats.sort((a, b) => b.bitrate - a.bitrate)[0] || null;
        if (!best) throw new Error("no plain audio formats");
        await assertStreamReachable(best.url, profile.ua, best.contentLength);
        log(`${profile.name} OK itag=${best.itag} bitrate=${best.bitrate}`);
        return { url: best.url, userAgent: profile.ua, itag: best.itag, codec: best.mimeType.includes("opus") ? "opus" : "aac", via: profile.name };
      } catch (err) {
        failures.push(`${profile.name}#${attempt}: ${err.message}`);
        break; // move to the next profile
      }
    }
  }
  log("all profiles refused:", failures.join(" | "));
  return null;
}

// yt-dlp helper: run with args, parse -J JSON. Never throws.
// (Callers choose whether to include ytCookieArgs() — cookies are opt-in
// per attempt, see ytDlpResolve.)
function ytDlpJson(args) {
  return new Promise((resolve) => {
    execFile("yt-dlp", args, { timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        log("yt-dlp failed:", err?.message || "empty output");
        return resolve(null);
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        log("yt-dlp parse failed:", e.message);
        resolve(null);
      }
    });
  });
}

function streamFromInfo(info) {
  if (!info) return null;
  let fmt = info?.requested_formats?.find((f) => String(f.mimeType || "").startsWith("audio"));
  if (!fmt && info?.formats) {
    fmt = info.formats
      .filter((f) => String(f.mimeType || "").startsWith("audio") && f.url)
      .sort((a, b) => (b.abr || b.bitrate || 0) - (a.abr || a.bitrate || 0))[0];
  }
  const url = fmt?.url || info?.url;
  if (!url) return null;
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  return {
    url,
    userAgent: ua,
    itag: fmt?.itag || info?.format_id || 0,
    codec: String(fmt?.mimeType || info?.ext || "").includes("opus") || String(fmt?.mimeType || "").includes("webm") ? "opus" : "aac",
    via: "yt-dlp",
    meta: { title: info.title, duration: info.duration },
  };
}

function ytDlpResolve(watchUrl) {
  const base = ["--no-playlist", "--skip-download", "--no-warnings", "--socket-timeout", "12", "--retries", "2", "-f", "bestaudio/best", "-J", watchUrl];
  // First attempt: anonymous (datacenter-safe, PO-token-free). Only if that
  // fails, retry WITH the owner's cookies — logged-in extraction returns zero
  // formats on some datacenter IPs (PO-token enforcement), so cookies must
  // never replace the anonymous path, only chase it.
  return ytDlpJson(base).then((info) => {
    const stream = streamFromInfo(info);
    if (stream || !cookieReady) return stream;
    log("anonymous yt-dlp failed — retrying with owner cookies");
    return ytDlpJson([...ytCookieArgs(), ...base]).then(streamFromInfo);
  });
}

// SoundCloud fallback (alfredo.py Task 23 parity): scsearch is NOT
// bot-checked on datacenter egress, so it rescues playback when YouTube
// refuses every client from this network.
async function soundcloudResolve(hint) {
  const flat = await ytDlpJson(["--no-warnings", "--socket-timeout", "12", "--flat-playlist", "-J", `scsearch1:${hint}`]);
  const entry = Array.isArray(flat?.entries) ? flat.entries[0] : null;
  const trackUrl = entry?.webpage_url || (String(entry?.url || "").startsWith("https://") ? entry.url : null);
  if (!trackUrl) {
    log("soundcloud: no track found for", JSON.stringify(hint));
    return null;
  }
  const info = await ytDlpJson(["--no-playlist", "--skip-download", "--no-warnings", "--socket-timeout", "12", "--retries", "2", "-f", "bestaudio/best", "-J", trackUrl]);
  const stream = streamFromInfo(info);
  if (stream) {
    stream.meta = { title: entry.title || info?.title, duration: entry.duration || info?.duration };
    log(`soundcloud OK: ${JSON.stringify(stream.meta.title)}`);
  }
  return stream;
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input) {
  const s = String(input || "").trim();
  let m = s.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (VIDEO_ID_RE.test(s)) return s;
  return null;
}

// Full resolve chain for a watch URL. Never throws — returns null on total
// failure so the caller can surface a friendly embed.
// searchHint: "title artist" — used for the SoundCloud fallback when YouTube
// refuses everything from this network (alfredo.py Task 23 parity).
async function resolveStream(watchUrl, searchHint) {
  const videoId = extractVideoId(watchUrl);
  if (!videoId) return null;
  const innertube = await innertubeResolve(videoId);
  if (innertube) return innertube;
  log("falling back to yt-dlp");
  const ytd = await ytDlpResolve(watchUrl);
  if (ytd) return ytd;
  if (searchHint) {
    log("youtube refused — trying SoundCloud fallback");
    const sc = await soundcloudResolve(searchHint);
    if (sc) return sc;
  }
  return null;
}

module.exports = { resolveStream, innertubeResolve, ytDlpResolve, soundcloudResolve, extractVideoId, ytCookieArgs };
