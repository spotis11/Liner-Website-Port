// Verify chart playlist resolves tracks through the app's real mapper.
import { getPlaylist } from "../liner-app/src/shared/youtube/innertube/innertubeCollections.ts";

const details = await getPlaylist("VLOLAK5uy_neyQTveO4qXSOjNLG6ob79xCELkByYg60");
console.log("title:", details.title);
console.log("author:", details.author);
console.log("trackCount:", details.trackCount);
console.log("tracks:", details.tracks.length);
console.log("first tracks:", details.tracks.slice(0, 5).map((t) => `${t.title} — ${t.artists.map((a) => a.name).join(", ")}`));
