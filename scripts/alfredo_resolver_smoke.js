// Smoke test for the alfredo-node resolver chain (no Discord login involved).
// 1. YTM search for a song query → videoId
// 2. InnerTube profile resolve → reachable stream URL (same UA as ffmpeg)
// 3. fallback probe: what yt-dlp alone would return
"use strict";
const { searchTrack, parseSongQuery } = require("/home/z/my-project/alfredo-node/lib/ytmsearch");
const { resolveStream, innertubeResolve, extractVideoId } = require("/home/z/my-project/alfredo-node/lib/innertube");

(async () => {
  const query = process.argv[2] || "chei sudahlah (by angga dermawan)";
  console.log("parsed:", JSON.stringify(parseSongQuery(query)));
  const cand = await searchTrack(query);
  if (!cand) {
    console.log("SEARCH FAILED — no candidates");
    process.exit(1);
  }
  console.log("picked:", JSON.stringify({ videoId: cand.videoId, title: cand.title, artists: cand.artists, duration: cand.duration }));
  const watchUrl = `https://www.youtube.com/watch?v=${cand.videoId}`;
  const t0 = Date.now();
  const hint = `${cand.title} ${cand.artists === "Song" ? "" : cand.artists}`.trim();
  const stream = await resolveStream(watchUrl, hint || query);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (!stream) {
    console.log(`RESOLVE FAILED (${dt}s)`);
    process.exit(2);
  }
  console.log(`resolved in ${dt}s via=${stream.via} itag=${stream.itag} codec=${stream.codec} uaLen=${stream.userAgent.length} urlLen=${stream.url.length}`);
  process.exit(0);
})().catch((e) => {
  console.error("test crashed:", e);
  process.exit(3);
});
