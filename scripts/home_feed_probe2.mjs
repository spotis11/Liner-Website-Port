// Deep probe of FEmusic_home shelf structure.
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
const json = await res.json();
const contents =
  json.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    ?.content?.sectionListRenderer?.contents ?? [];
console.log("shelves:", contents.length);

function headerOf(shelf) {
  const r = shelf.musicCarouselShelfRenderer ?? shelf.musicShelfRenderer;
  const h = r?.header;
  if (!h) return null;
  const key = Object.keys(h)[0];
  const inner = h[key];
  return {
    headerKey: key,
    title:
      inner?.title?.content ??
      inner?.musicCarouselShelfBasicHeaderRenderer?.title?.content ??
      null,
    moreKey: Object.keys(inner ?? {}).join(","),
  };
}

for (const [i, shelf] of contents.entries()) {
  const r = shelf.musicCarouselShelfRenderer ?? shelf.musicShelfRenderer;
  const items = r?.contents ?? [];
  const kindCount = {};
  for (const item of items) {
    for (const k of Object.keys(item)) kindCount[k] = (kindCount[k] ?? 0) + 1;
  }
  console.log(`[${i}] shelf=${shelf.musicCarouselShelfRenderer ? "carousel" : "shelf"} header=${JSON.stringify(headerOf(shelf))} items=${items.length} kinds=${JSON.stringify(kindCount)}`);
}

// Sample: first item of first shelf fully
const first = contents[0]?.musicCarouselShelfRenderer?.contents?.[0]
  ?? contents[0]?.musicShelfRenderer?.contents?.[0];
console.log("\n=== SAMPLE ITEM 0.0 ===");
console.log(JSON.stringify(first, null, 1).slice(0, 3000));

// Header of shelf 1
const shelf1 = contents[1];
console.log("\n=== SHELF 1 HEADER ===");
console.log(JSON.stringify(headerOf(shelf1)));
const r1 = shelf1.musicCarouselShelfRenderer ?? shelf1.musicShelfRenderer;
console.log("shelf1 item0:", JSON.stringify(r1?.contents?.[0], null, 1).slice(0, 2500));

// continuations?
console.log("\ncontinuation present:",
  !!json.continuationContents?.sectionListContinuationRenderer,
  !!json.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.continuations);
