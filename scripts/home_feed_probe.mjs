// Probe: YouTube Music home feed (FEmusic_home) through the SPA's same-origin
// innertube proxy (/api/yt -> music.youtube.com/youtubei/v1/browse).
const BASE = process.env.BASE ?? "http://localhost:3000";

const body = {
  browseId: "FEmusic_home",
  context: {
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20260911.08.00",
      hl: "en",
      gl: "US",
    },
  },
};

const res = await fetch(`${BASE}/api/yt/v1/browse?prettyPrint=false`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-youtube-client-name": "67",
    "x-youtube-client-version": "1.20260911.08.00",
    "x-origin": "https://music.youtube.com",
  },
  body: JSON.stringify(body),
});

console.log("status:", res.status);
const text = await res.text();
console.log("bytes:", text.length);
if (!res.ok) {
  console.log(text.slice(0, 600));
  process.exit(1);
}
const json = JSON.parse(text);
const contents =
  json.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    ?.content?.sectionListRenderer?.contents ?? [];
console.log("shelves:", contents.length);
for (const [i, shelf] of contents.entries()) {
  const shelfRenderer =
    shelf.musicCarouselShelfRenderer ?? shelf.musicShelfRenderer;
  const header = shelfRenderer?.header?.musicCarouselShelfBasicHeaderRenderer
    ?.title?.content ?? shelfRenderer?.header?.musicHeaderRendererTitle ?? "(no header)";
  const items =
    shelfRenderer?.contents?.musicShelfRenderer?.contents ??
    shelfRenderer?.contents ??
    [];
  const kinds = {};
  for (const item of items) {
    for (const key of Object.keys(item)) {
      kinds[key] = (kinds[key] ?? 0) + 1;
    }
  }
  console.log(
    `[${i}] "${header}" items=${items.length} kinds=${JSON.stringify(kinds)}`,
  );
}
