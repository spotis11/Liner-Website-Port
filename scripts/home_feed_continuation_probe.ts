// Check the FEmusic_home continuation pass: does it return more shelves?
import { postInnertube } from "../liner-app/src/shared/youtube/innertube/innertubeClient.ts";
import { asArray, asRecord } from "../liner-app/src/shared/utils/json.ts";
import { mapHomeShelf } from "../liner-app/src/shared/youtube/innertube/innertubeHomeFeed.ts";

const body = await postInnertube("browse", { browseId: "FEmusic_home" });
const tabs = asArray(
  asRecord(asRecord(body?.contents)?.singleColumnBrowseResultsRenderer)?.tabs,
);
const tab = asRecord(asRecord(tabs[0])?.tabRenderer);
const sectionList = asRecord(
  asRecord(asRecord(tab?.content))?.sectionListRenderer,
);
const conts = asArray(sectionList?.continuations);
const next = asRecord(asRecord(conts[0])?.nextContinuationData);
console.log("continuation token present:", typeof next?.continuation === "string");

if (typeof next?.continuation === "string") {
  const body2 = await postInnertube("browse", {
    browseId: "FEmusic_home",
    continuation: next.continuation,
  });
  const tabs2 = asArray(
    asRecord(asRecord(body2?.contents)?.singleColumnBrowseResultsRenderer)?.tabs,
  );
  const tab2 = asRecord(asRecord(tabs2[0])?.tabRenderer);
  const sl2 = asRecord(asRecord(asRecord(tab2?.content))?.sectionListRenderer);
  const shelves2 = asArray(sl2?.contents)
    .map((s) => mapHomeShelf(s))
    .filter(Boolean);
  console.log("continuation shelves:", shelves2.length);
  for (const shelf of shelves2) {
    console.log(
      `  "${shelf.title}" tracks=${shelf.tracks.length} collections=${shelf.collections.length}`,
    );
  }
  console.log("top-level keys of body2:", Object.keys(asRecord(body2) ?? {}));
}
