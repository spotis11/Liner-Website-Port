// Task 34: probe ALTERNATE innertube clients from this egress IP against the
// bot-checked videos. Any client that returns OK + reachable audio becomes a
// new fallback playback profile for the web port.
//
//   node task34_clients.mjs <videoId> [videoId...]

const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CLIENTS = [
  {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    version: "2.0", id: "85",
    origin: "https://www.youtube.com",
    userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 4.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 TV Safari/537.36",
    includeUaInContext: true,
    extraContext: { thirdParty: { embedUrl: "https://www.youtube.com/" } },
    extraHeaders: { referer: "https://www.youtube.com/" },
  },
  {
    name: "WEB_EMBEDDED_PLAYER",
    version: "1.20250910.01.00", id: "56",
    origin: "https://www.youtube.com",
    userAgent: UA_BROWSER,
    includeUaInContext: false,
    extraContext: { thirdParty: { embedUrl: "https://www.youtube.com/" } },
    extraHeaders: { referer: "https://www.youtube.com/" },
  },
  {
    name: "IOS",
    version: "20.10.4", id: "5",
    origin: "https://www.youtube.com",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    includeUaInContext: true,
    extraContext: { osName: "iPhone", osVersion: "18.3.2.22D82", deviceMake: "Apple", deviceModel: "iPhone16,2" },
  },
  {
    name: "ANDROID",
    version: "20.10.38", id: "3",
    origin: "https://www.youtube.com",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    includeUaInContext: true,
    extraContext: { osName: "Android", osVersion: "11", deviceMake: "Google", deviceModel: "Pixel 6", androidSdkVersion: 30 },
  },
  {
    name: "ANDROID_MUSIC",
    version: "7.27.50", id: "21",
    origin: "https://music.youtube.com",
    userAgent: "com.google.android.apps.youtube.music/7.27.50 (Linux; U; Android 11) gzip",
    includeUaInContext: true,
    extraContext: { osName: "Android", osVersion: "11", deviceMake: "Google", deviceModel: "Pixel 6", androidSdkVersion: 30 },
  },
  {
    name: "IOS_MUSIC",
    version: "7.27.50", id: "54",
    origin: "https://music.youtube.com",
    userAgent: "com.google.ios.youtubemusic/7.27.50 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    includeUaInContext: true,
    extraContext: { osName: "iPhone", osVersion: "18.3.2.22D82", deviceMake: "Apple", deviceModel: "iPhone16,2" },
  },
  {
    name: "MWEB",
    version: "2.20250911.03.00", id: "2",
    origin: "https://www.youtube.com",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
    includeUaInContext: true,
    extraContext: {},
  },
];

const VISITOR_DATA_PATTERN = /Cg[s-v][A-Za-z0-9_-]{20,}(?:%3D|=){0,2}/;
async function visitorData() {
  const res = await fetch("https://www.youtube.com/sw.js_data", {
    headers: { "user-agent": UA_BROWSER },
  });
  return (await res.text()).match(VISITOR_DATA_PATTERN)?.[0] ?? "";
}

async function probe(url) {
  const u = new URL(url);
  u.searchParams.set("range", "0-0");
  const r = await fetch(u.toString());
  await r.body?.cancel().catch(() => undefined);
  return r.status;
}

async function testClient(client, videoId, vd) {
  const payload = {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: {
        clientName: client.name,
        clientVersion: client.version,
        hl: "en", gl: "US",
        ...(vd ? { visitorData: vd } : {}),
        ...(client.includeUaInContext ? { userAgent: client.userAgent } : {}),
        ...client.extraContext,
      },
      user: { lockedSafetyMode: false },
      ...(client.name.includes("EMBEDDED")
        ? { thirdParty: { embedUrl: "https://www.youtube.com/" } }
        : {}),
    },
  };
  const res = await fetch(`${client.origin}/youtubei/v1/player?prettyPrint=false`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-youtube-client-name": client.id,
      "x-youtube-client-version": client.version,
      "x-origin": client.origin,
      "user-agent": client.userAgent,
      ...(vd ? { "x-goog-visitor-id": vd } : {}),
      ...client.extraHeaders,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  const status = body?.playabilityStatus?.status ?? `HTTP ${res.status}`;
  const reason = body?.playabilityStatus?.reason ?? "";
  if (status !== "OK") return `${status}${reason ? " (" + reason.slice(0, 70) + ")" : ""}`;
  const formats = (body?.streamingData?.adaptiveFormats ?? [])
    .filter((f) => String(f.mimeType ?? f.mime_type ?? "").startsWith("audio/") && !f.hasVideo)
    .map((f) => ({ itag: f.itag, url: f.url, sc: f.signatureCipher || f.cipher, bitrate: f.bitrate ?? 0 }));
  const direct = formats.filter((f) => f.url);
  if (direct.length === 0)
    return `OK but ${formats.length} ciphered formats only (needs decipher)`;
  const best = direct.sort((a, b) => b.bitrate - a.bitrate)[0];
  const p = await probe(best.url);
  return `OK + ${formats.length} audio formats, probe ${p}${p !== 200 ? " << REFUSED" : " (playable!)"}`;
}

const videoIds = process.argv.slice(2);
for (const videoId of videoIds) {
  console.log(`\n=== ${videoId} ===`);
  const vd = await visitorData();
  for (const client of CLIENTS) {
    try {
      const result = await testClient(client, videoId, vd);
      console.log(`  ${client.name.padEnd(32)} ${result}`);
    } catch (e) {
      console.log(`  ${client.name.padEnd(32)} threw: ${String(e).slice(0, 100)}`);
    }
  }
}
