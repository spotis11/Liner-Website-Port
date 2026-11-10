// Reproduce the SPA's exact home-feed wire format through :3000,
// including the x-goog-visitor-id header + context.client.visitorData
// exactly like postInnertube() does with getClientVisitorData().

const BASE = process.env.BASE || "http://localhost:3000";

async function getVisitorData() {
  const res = await fetch("https://www.youtube.com/sw.js_data", {
    signal: AbortSignal.timeout(8000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const text = await res.text();
  const m = text.match(/"visitorData":"([^"]+)"/);
  return m ? m[1] : null;
}

async function spaBrowse(label, visitorData) {
  const url = `${BASE}/api/yt/v1/browse?prettyPrint=false`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "x-youtube-client-name": "67",
    "x-youtube-client-version": "1.20260911.08.00",
    "x-origin": "https://music.youtube.com",
  };
  if (visitorData) headers["x-goog-visitor-id"] = visitorData;
  const body = {
    browseId: "FEmusic_home",
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion: "1.20260911.08.00",
        hl: "en",
        gl: "US",
        ...(visitorData ? { visitorData } : {}),
      },
      user: { lockedSafetyMode: false },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let shelves = 0;
  try {
    const contents =
      JSON.parse(text)?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    shelves = contents.filter(
      (c) => c.musicCarouselShelfRenderer || c.musicShelfRenderer,
    ).length;
  } catch {}
  console.log(
    `${label}: HTTP ${res.status} bytes=${text.length} shelves=${shelves}` +
      (res.ok && shelves === 0 ? ` head=${text.slice(0, 120)}` : ""),
  );
}

const vd = await getVisitorData().catch((e) => {
  console.log("sw.js_data fetch failed:", e.message);
  return null;
});
console.log("visitorData fetched:", vd ? `${vd.slice(0, 24)}...` : "NONE");
await spaBrowse("SPA wire WITH fresh visitorData ", vd);
await spaBrowse("SPA wire with EMPTY visitorData   ", "");
await spaBrowse("SPA wire with GARBAGE visitorData ", "Gp8L Ihis is garbage base64!!");
