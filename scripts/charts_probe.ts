// Probe FEmusic_charts as supplementary track source.
import { postInnertube } from "../liner-app/src/shared/youtube/innertube/innertubeClient.ts";
import { asArray, asRecord } from "../liner-app/src/shared/utils/json.ts";
import { mapHomeShelf } from "../liner-app/src/shared/youtube/innertube/innertubeHomeFeed.ts";

for (const browseId of ["FEmusic_charts", "FEmusic_home"]) {
  const body = await postInnertube("browse", { browseId });
  const tabs = asArray(
    asRecord(asRecord(body?.contents)?.singleColumnBrowseResultsRenderer)?.tabs,
  );
  const tab = asRecord(asRecord(tabs[0])?.tabRenderer);
  const sl = asRecord(asRecord(asRecord(tab?.content))?.sectionListRenderer);
  const shelves = asArray(sl?.contents)
    .map((s) => mapHomeShelf(s))
    .filter(Boolean);
  console.log(`\n=== ${browseId} ===`);
  for (const shelf of shelves) {
    console.log(
      `  "${shelf.title}" tracks=${shelf.tracks.length} collections=${shelf.collections.length}`,
    );
  }
}
