// Live test: home feed browse (FEmusic_home) via SPA proxy.
// 1) Current path: WEB_REMIX through /api/yt/v1/browse
// 2) Riff path:    IOS client through /api/yt/www/v1/browse + x-liner-user-agent
// 3) Riff path:    ANDROID_MUSIC through /api/yt/v1/browse (music origin)
const BASE = "http://localhost:3000";

const IOS_PROFILE = {
  clientName: "IOS",
  clientVersion: "20.10.4",
  clientIdHeader: "5",
  origin: "https://www.youtube.com",
  userAgent:
    "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  extraContext: {
    osName: "iOS",
    osVersion: "18.3.2.22D60",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
  },
};

const WEB_REMIX = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20260911.08.00",
  clientIdHeader: "67",
  origin: "https://music.youtube.com",
};

const ANDROID_MUSIC = {
  clientName: "ANDROID_MUSIC",
  clientVersion: "7.27.52",
  clientIdHeader: "21",
  origin: "https://music.youtube.com",
  userAgent:
    "com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US; Quest 3) gzip",
  extraContext: { androidSdkVersion: 34 },
};

function countShelves(body) {
  const contents =
    body?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents ??
    body?.continuationContents?.sectionListContinuationRenderer?.contents ??
    [];
  let shelves = 0;
  let carousels = 0;
  let twoRow = 0;
  let musicShelf = 0;
  for (const item of contents) {
    if (item.musicCarouselShelfRenderer) {
      carousels += 1;
      shelves += 1;
      for (const inner of item.musicCarouselShelfRenderer.contents ?? []) {
        if (inner.musicTwoRowItemRenderer) twoRow += 1;
        if (inner.musicResponsiveListItemRenderer) musicShelf += 1;
      }
    }
    if (item.musicShelfRenderer) {
      shelves += 1;
      for (const inner of item.musicShelfRenderer.contents ?? []) {
        if (inner.musicResponsiveListItemRenderer) musicShelf += 1;
      }
    }
  }
  return { sections: contents.length, shelves, carousels, twoRow, musicShelf };
}

async function testBrowse(label, mount, profile, browseId = "FEmusic_home") {
  const url = `${BASE}${mount}/v1/browse?prettyPrint=false`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "x-youtube-client-name": profile.clientIdHeader,
    "x-youtube-client-version": profile.clientVersion,
    "x-origin": profile.origin,
  };
  if (profile.userAgent) headers["x-liner-user-agent"] = profile.userAgent;
  const body = {
    context: {
      client: {
        clientName: profile.clientName,
        clientVersion: profile.clientVersion,
        hl: "en",
        gl: "US",
        ...(profile.extraContext ?? {}),
      },
      user: { lockedSafetyMode: false },
    },
    browseId,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const counts = json ? countShelves(json) : null;
    console.log(
      `${label}: HTTP ${res.status} bytes=${text.length} ` +
        (counts
          ? `sections=${counts.sections} shelves=${counts.shelves} carousels=${counts.carousels} twoRow=${counts.twoRow} tracks=${counts.musicShelf}`
          : `body=${text.slice(0, 160)}`),
    );
    return res.ok && counts && (counts.twoRow > 0 || counts.musicShelf > 0);
  } catch (error) {
    console.log(`${label}: FAILED ${error.message}`);
    return false;
  }
}

console.log("=== Home feed browse client test ===");
await testBrowse("WEB_REMIX /api/yt (current prod path)", "/api/yt", WEB_REMIX);
await testBrowse("IOS /api/yt/www (Riff style)", "/api/yt/www", IOS_PROFILE);
await testBrowse(
  "ANDROID_MUSIC /api/yt (music origin)",
  "/api/yt",
  ANDROID_MUSIC,
);
await testBrowse(
  "IOS charts browse /api/yt/www",
  "/api/yt/www",
  IOS_PROFILE,
  "FEmusic_charts",
);
