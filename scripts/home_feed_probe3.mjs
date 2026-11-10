// Dump raw shelf headers + item titles from FEmusic_home.
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

for (const [i, shelf] of contents.entries()) {
  const r = shelf.musicCarouselShelfRenderer ?? shelf.musicShelfRenderer;
  console.log(`\n===== SHELF ${i} RAW HEADER =====`);
  console.log(JSON.stringify(r?.header, null, 1)?.slice(0, 1200));
  const items = r?.contents ?? [];
  for (const [j, item] of items.slice(0, 4).entries()) {
    const twoRow = item.musicTwoRowItemRenderer;
    if (twoRow) {
      const title = twoRow.title?.runs?.map((r) => r.text).join("") ?? null;
      const subtitle =
        twoRow.subtitle?.runs?.map((r) => r.text).join("") ?? null;
      const nav = twoRow.navigationEndpoint;
      const watch = nav?.watchEndpoint;
      const browse = nav?.browseEndpoint;
      console.log(
        `  [${j}] twoRow title="${title}" subtitle="${subtitle}" watch=${JSON.stringify(watch ? { videoId: watch.videoId, playlistId: watch.playlistId } : null)} browse=${JSON.stringify(browse ? { browseId: browse.browseId, params: (browse.params ?? "").slice(0, 12) } : null)} pageType=${nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType}`,
      );
    } else {
      const list = item.musicResponsiveListItemRenderer;
      const cols = list?.flexColumns ?? [];
      const colTexts = cols.map((c) =>
        (c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [])
          .map((r) => r.text)
          .join(""),
      );
      const watch =
        cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint;
      console.log(
        `  [${j}] listItem cols=${JSON.stringify(colTexts)} watch=${JSON.stringify(watch ? { videoId: watch.videoId, playlistId: watch.playlistId } : null)}`,
      );
    }
  }
}
console.log(
  "\nsection continuation:",
  JSON.stringify(
    json.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.continuations ?? null,
  ),
);
