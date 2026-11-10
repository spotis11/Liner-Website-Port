// Live smoke test of the innertube home feed module (bun runs TS directly).
// Uses direct music.youtube.com access (no window -> no proxy rewrite).
import {
  fetchInnertubeHomeFeed,
  collectHomeFeedItems,
} from "../liner-app/src/shared/youtube/innertube/innertubeHomeFeed.ts";

const shelves = await fetchInnertubeHomeFeed();
const items = collectHomeFeedItems(shelves);
console.log("shelves:", shelves.length);
for (const shelf of shelves) {
  console.log(
    `  "${shelf.title ?? "(untitled)"}" tracks=${shelf.tracks.length} collections=${shelf.collections.length}`,
  );
}
console.log("\nquickPicks:", items.quickPicks.length);
console.log("sample track:", JSON.stringify(items.quickPicks[0], null, 1));
console.log("albums:", items.albums.length, "playlists:", items.playlists.length);
console.log("sample playlist:", JSON.stringify(items.playlists[0], null, 1));
console.log("sample album:", JSON.stringify(items.albums[0], null, 1));
