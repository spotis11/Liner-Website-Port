// Reproduce the "Flashback by JD Smith" playback failure through the same
// proxy chain the web port uses (localhost:3000).
const BASE = "http://localhost:3000";

async function innertube(mount, endpoint, body, ua) {
  const headers = { "content-type": "application/json" };
  if (ua) headers["x-liner-user-agent"] = ua;
  const res = await fetch(`${BASE}/api/yt${mount}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text: text.slice(0, 300) };
  }
}

function webRemixContext() {
  return {
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20260911.08.00",
      hl: "en",
      gl: "US",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36,gzip(gfe)",
    },
  };
}

async function searchVideo(query) {
  const { status, json, text } = await innertube("", "search", {
    context: webRemixContext(),
    query,
  });
  if (status !== 200) {
    console.log("SEARCH HTTP", status, text ?? "");
    return null;
  }
  const contents =
    json?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.sectionListRenderer?.contents ?? [];
  for (const section of contents) {
    const items =
      section?.musicShelfRenderer?.contents ??
      section?.musicCardShelfRenderer ??
      [];
    const list = Array.isArray(items) ? items : [items];
    for (const it of list) {
      const r =
        it?.musicResponsiveListItemRenderer ??
        it?.musicCardShelfRenderer?.titleRenderer ??
        null;
      if (!r) continue;
      const title = r?.title?.runs?.[0]?.text ?? r?.title?.simpleText ?? "";
      const subtitle =
        r?.subtitle?.runs?.map((x) => x.text).join("") ??
        r?.flexColumns?.map((c) => c.musicResponsiveListItemFlexColumnRenderer.text.runs.map((x) => x.text).join("")).join(" | ") ??
        "";
      const id =
        r?.playlistItemData?.videoId ??
        r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
        r?.navigationEndpoint?.watchEndpoint?.videoId;
      if (id) console.log(`FOUND: "${title}" | ${subtitle} | ${id}`);
    }
  }
  return null;
}

function profileBody(videoId, profile) {
  const client = {
    clientName: profile.clientName,
    clientVersion: profile.clientVersion,
    hl: "en",
    gl: "US",
    ...(profile.extraContext ?? {}),
  };
  if (profile.includeUserAgentInContext) client.userAgent = profile.userAgent;
  return {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: { client },
  };
}

async function tryProfile(name, mount, videoId, profile) {
  const { status, json, text } = await innertube(
    mount,
    "player",
    profileBody(videoId, profile),
    profile.userAgent,
  );
  const ps = json?.playabilityStatus;
  const fmts = json?.streamingData?.adaptiveFormats ?? [];
  const audio = fmts.filter((f) => String(f.mimeType ?? "").startsWith("audio"));
  console.log(
    `${name}: http=${status} playability=${ps?.status ?? "?"} reason=${JSON.stringify(ps?.reason ?? null)} audioFormats=${audio.length} total=${fmts.length}`,
  );
  if (ps?.status !== "OK") {
    console.log(`   errorScreen: ${JSON.stringify(ps?.errorScreen ?? null).slice(0, 200)}`);
  }
  return { status: ps?.status, audio };
}

const TV_PROFILE = {
  clientName: "TVHTML5",
  clientVersion: "7.20260707.07.00",
  userAgent:
    "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
};
const VISIONOS_PROFILE = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  extraContext: { osName: "visionOS", osVersion: "26.5.23O471", deviceMake: "Apple", deviceModel: "RealityDevice17,1" },
};
const ANDROID_VR_PROFILE = {
  clientName: "ANDROID_VR",
  clientVersion: "1.65.10",
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  extraContext: { osName: "Android", osVersion: "12L", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32 },
};

const query = process.argv[2] ?? "flashback jd smith";
console.log(`=== searching: ${query}`);
await searchVideo(query);

const videoId = process.argv[3];
if (videoId) {
  console.log(`=== player probes for ${videoId}`);
  await tryProfile("WEB_REMIX (music)", "", videoId, {
    clientName: "WEB_REMIX",
    clientVersion: "1.20260911.08.00",
  });
  await tryProfile("TVHTML5", "/www", videoId, TV_PROFILE);
  await tryProfile("VISIONOS", "/www", videoId, VISIONOS_PROFILE);
  await tryProfile("ANDROID_VR", "/www", videoId, ANDROID_VR_PROFILE);

  console.log("=== PO token mint");
  try {
    const pr = await fetch(`${BASE}/api/po-token?videoId=${encodeURIComponent(videoId)}`);
    const pj = await pr.json();
    console.log("po-token:", pr.status, pj.poToken ? `${String(pj.poToken).slice(0, 24)}... (len ${String(pj.poToken).length})` : JSON.stringify(pj).slice(0, 200));
    if (pj.poToken) {
      // WEB_REMIX player WITH content po token, like the app sends
      const body = profileBody(videoId, { clientName: "WEB_REMIX", clientVersion: "1.20260911.08.00" });
      body.playbackContext = {
        contentPlaybackContext: { poToken: pj.poToken, contentPoToken: pj.poToken },
      };
      const { status, json } = await innertube("", "player", body);
      const ps = json?.playabilityStatus;
      const fmts = json?.streamingData?.adaptiveFormats ?? [];
      const audio = fmts.filter((f) => String(f.mimeType ?? "").startsWith("audio"));
      console.log(`WEB_REMIX+PO: http=${status} playability=${ps?.status ?? "?"} reason=${JSON.stringify(ps?.reason ?? null)} audioFormats=${audio.length}`);
      if (audio.length) {
        const a = audio[0];
        console.log(`   first audio: ${a.mimeType} bitrate=${a.bitrate} url=${a.url ? "present" : "MISSING"}`);
        if (a.url) {
          const head = await fetch(a.url, { method: "HEAD" }).catch((e) => ({ status: `ERR ${e.message}` }));
          console.log(`   stream HEAD: ${head.status} ${head.headers?.get?.("content-type") ?? ""}`);
        }
      }
    }
  } catch (e) {
    console.log("po-token probe failed:", e.message);
  }
}
