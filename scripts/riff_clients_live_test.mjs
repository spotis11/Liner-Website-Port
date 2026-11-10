// Live test: do riff's IOS / ANDROID_MUSIC innertube clients work from this
// egress (direct + through liner's /api/yt proxy), and does googlevideo then
// stream audio? Mirrors src/server/server.js fetchDirectYoutubeStreamServer.
const VIDEO_ID = process.argv[2] || "dQw4w9WgXcQ";

const CLIENTS = [
  {
    label: "IOS (www.youtube.com)",
    host: "www.youtube.com",
    clientName: "IOS",
    clientVersion: "20.10.4",
    clientIdHeader: "5",
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: {
      osName: "iOS",
      osVersion: "18.3.2.22D60",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
    },
  },
  {
    label: "ANDROID_MUSIC (music.youtube.com)",
    host: "music.youtube.com",
    clientName: "ANDROID_MUSIC",
    clientVersion: "7.27.52",
    clientIdHeader: "21",
    userAgent:
      "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US; Quest 3) gzip",
    context: { androidSdkVersion: 34 },
  },
];

async function visitorData() {
  try {
    const r = await fetch("https://www.youtube.com/sw.js_data", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const m = (await r.text()).match(/["']([Cgt][a-zA-Z0-9_%-]{10,60})["']/);
      if (m) return m[1];
    }
  } catch {}
  return "";
}

function audioFormats(data) {
  const sd = data.streamingData || {};
  const all = [...(sd.adaptiveFormats || []), ...(sd.formats || [])];
  return all.filter(
    (f) =>
      f &&
      f.url &&
      !f.signatureCipher &&
      !f.cipher &&
      typeof f.mimeType === "string" &&
      f.mimeType.startsWith("audio/"),
  );
}

async function verify(url, ua) {
  try {
    const probe = new URL(url);
    probe.searchParams.set("range", "0-0");
    const r = await fetch(probe.toString(), {
      headers: { "User-Agent": ua },
      signal: AbortSignal.timeout(8000),
    });
    await r.body?.cancel().catch(() => {});
    return { ok: r.status === 200 || r.status === 206, status: r.status };
  } catch (e) {
    return { ok: false, status: String(e) };
  }
}

async function tryClient(c, vd, baseUrl, endpoint) {
  const body = JSON.stringify({
    videoId: VIDEO_ID,
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: {
        clientName: c.clientName,
        clientVersion: c.clientVersion,
        hl: "en",
        gl: "US",
        androidSdkVersion: c.context.androidSdkVersion,
        ...(c.context.androidSdkVersion
          ? {}
          : {
              osName: c.context.osName,
              osVersion: c.context.osVersion,
              deviceMake: c.context.deviceMake,
              deviceModel: c.context.deviceModel,
            }),
        ...(vd && !vd.startsWith("%") ? {} : {}),
      },
      user: { lockedSafetyMode: false },
    },
  });
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": c.userAgent,
    "x-youtube-client-name": c.clientIdHeader,
    "x-youtube-client-version": c.clientVersion,
    "x-origin": `https://${c.host.split(".").slice(-2).join(".")}`,
    ...(vd ? { "x-goog-visitor-id": vd } : {}),
  };
  const t0 = Date.now();
  const r = await fetch(`${baseUrl}${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });
  const ms = Date.now() - t0;
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { label: c.label, http: r.status, ms, error: `non-JSON (${text.slice(0, 120)})` };
  }
  const play = data.playabilityStatus?.status;
  const formats = audioFormats(data);
  if (!formats.length) {
    const reason = data.playabilityStatus?.reason || "no audio formats";
    return { label: c.label, http: r.status, ms, playability: play, error: reason };
  }
  const best = formats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  const v = await verify(best.url, c.userAgent);
  return {
    label: c.label,
    http: r.status,
    ms,
    playability: play,
    formats: formats.map((f) => `${f.itag}:${f.mimeType.split(";")[0]}@${Math.round((f.bitrate || 0) / 1000)}k`),
    bestItag: best.itag,
    streamVerify: v,
  };
}

const vd = await visitorData();
console.log(`visitorData: ${vd ? "got " + vd.length + " chars" : "none"}`);

for (const via of ["DIRECT", "PROXY :3000 /api/yt/www", "PROXY :3000 /api/yt"]) {
  console.log(`\n=== via ${via} ===`);
  for (const c of CLIENTS) {
    const hostMatches =
      (via.includes("/api/yt/www") && c.host === "www.youtube.com") ||
      (via === "PROXY :3000 /api/yt" && c.host === "music.youtube.com");
    if (via !== "DIRECT" && !hostMatches) continue;
    const base =
      via === "DIRECT"
        ? `https://${c.host}`
        : via.includes("www")
          ? "http://localhost:3000/api/yt/www"
          : "http://localhost:3000/api/yt";
    // proxy mounts append "/youtubei/" themselves — liner's webProxy rewrites
    // <origin>/youtubei/v1/player -> /api/yt[/www]/v1/player
    const endpoint = via === "DIRECT" ? "/youtubei/v1/player" : "/v1/player";
    try {
      const out = await tryClient(c, vd, base, endpoint);
      console.log(JSON.stringify(out, null, 1));
    } catch (e) {
      console.log(`${c.label} -> THREW ${String(e).slice(0, 200)}`);
    }
  }
}
