// Time the FULL SoundCloud stand-in pipeline for the failing track,
// exactly as the app does it: search -> pick -> lookup -> HLS download.
const SHELL = "http://localhost:3000";
const CID = process.argv[2] ?? "3GKD969NJWD1eB6gvQJN0GnueYbcWszv";
const SC_ID = process.argv[3] ?? "934568899";
const t0 = Date.now();
const log = (m) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function timed(name, fn) {
  const v = await fn();
  log(`${name} ok`);
  return v;
}

// 1. search + pick (repro already proved scoring; skip to resolution)
const track = await timed("track lookup", () =>
  fetch(`${SHELL}/api/sc/tracks/${SC_ID}?client_id=${CID}`).then((r) => r.json()),
);
const auth = track.track_authorization;
const aac = (track.media?.transcodings ?? []).find(
  (x) => x.format?.protocol === "hls" && x.format?.mime_type?.includes("mp4"),
);
if (!aac) { console.log("no aac hls transcoding"); process.exit(1); }

// 2. media url lookup (with track_authorization like the app)
const lookupUrl = new URL(aac.url);
if (auth) lookupUrl.searchParams.set("track_authorization", auth);
const media = await timed("media url lookup", () =>
  fetch(lookupUrl, { headers: { accept: "application/json" } }).then((r) => r.json()),
);
if (!media.url) { console.log("lookup empty:", JSON.stringify(media).slice(0, 200)); process.exit(1); }

// 3. playlist
const pl = await timed("playlist fetch", () => fetch(media.url).then((r) => r.text()));
const lines = pl.split("\n").map((l) => l.trim()).filter(Boolean);
const segs = lines.filter((l) => !l.startsWith("#"));
const mapLine = lines.find((l) => l.startsWith("#EXT-X-MAP"));
const init = mapLine ? /URI="([^"]+)"/.exec(mapLine)?.[1] : null;
const base = media.url;
const resolve = (u) => new URL(u, base).toString();
const urls = init ? [resolve(init), ...segs.map(resolve)] : segs.map(resolve);
log(`segments: ${segs.length}${init ? " +init" : ""}`);

// 4. download all segments, concurrency 6 (app's runWorkerPool default)
let total = 0;
let done = 0;
const parts = new Array(urls.length).fill(null);
async function grab(url, i) {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      parts[i] = buf;
      total += buf.byteLength;
      done++;
      if (done % 8 === 0) log(`  ${done}/${urls.length} segs, ${(total / 1e6).toFixed(1)}MB`);
      return;
    } catch (e) {
      if (a === 1) throw e;
    }
  }
}
const workers = Array.from({ length: 6 }, async () => {
  while (urls.length) {
    const i = urls.shift() ?? "";
    const idx = parts.length - urls.length - 1;
    await grab(i, idx);
  }
});
await Promise.all(workers);
log(`downloaded ${(total / 1e6).toFixed(2)}MB total`);
const out = new Uint8Array(total);
let off = 0;
for (const p of parts) { out.set(p, off); off += p.byteLength; }
log(`DONE — full pipeline ${(Date.now() - t0) / 1000}s (app deadline: 15s)`);
console.log(`bytes=${out.byteLength} — would be a Blob(audio/mp4)`);
