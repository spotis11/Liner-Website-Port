// Test the SoundCloud stand-in rescue for "Flashback" by JD Smith through the
// shell's /api/sc proxy, replicating scoreStandInCandidate exactly.
const SHELL = "http://localhost:3000";

function normalizeForMatch(value) {
  return value
    .toLowerCase()
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, " ")
    .replace(/\b(feat|ft|featuring|prod|official|video|audio|lyrics?|hd|hq)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const tokens = (v) => (normalizeForMatch(v) ? normalizeForMatch(v).split(" ") : []);
function tokenCoverage(wanted, have) {
  if (!wanted.length) return 0;
  const set = new Set(have);
  let hit = 0;
  for (const t of wanted) if (set.has(t)) hit += 1;
  return hit / wanted.length;
}
function durationScore(wantedMs, candidateMs) {
  if (!wantedMs || !candidateMs) return 0.5;
  const delta = Math.abs(wantedMs - candidateMs);
  const tol = Math.max(wantedMs * 0.35, 45000);
  if (delta > tol) return 0;
  return 1 - delta / tol;
}
function score(track, c) {
  const wantedTitle = tokens(track.title);
  const wantedArtist = tokens(track.artists);
  const haveTitle = tokens(c.title);
  const haveArtist = tokens(c.artist);
  const titleScore = Math.max(
    tokenCoverage(wantedTitle, haveTitle),
    tokenCoverage(wantedTitle, [...haveTitle, ...haveArtist]),
  );
  const artistScore = wantedArtist.length
    ? tokenCoverage(wantedArtist, [...haveArtist, ...haveTitle])
    : 0.75;
  if (titleScore < 0.6) return 0;
  if (wantedArtist.length && artistScore < 0.5) return 0;
  const d = durationScore(track.durationMs, c.durationMs);
  if (track.durationMs && c.durationMs && d === 0) return 0;
  return titleScore * 2 + artistScore + d;
}

// the Liner catalog metadata the app would have for this track
const track = {
  title: "Flashback",
  artists: "JD Smith",
  durationMs: Number(process.argv[3] ?? 264000),
};

async function main() {
  // discover a client_id the way the app does: hit the web page, grep the ids
  const page = await fetch("https://soundcloud.com/discover")
    .then((r) => r.text())
    .catch(() => "");
  const ids = [...page.matchAll(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{25,40})["']/g)].map((m) => m[1]);
  const scriptUrls = [...page.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).slice(-6);
  let clientId = ids[0] ?? null;
  if (!clientId) {
    for (const u of scriptUrls) {
      const js = await fetch(u).then((r) => r.text()).catch(() => "");
      const m = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{25,40})["']/);
      if (m) { clientId = m[1]; break; }
    }
  }
  console.log("clientId:", clientId ?? "NONE");

  const q = `${track.title} ${track.artists}`;
  const res = await fetch(
    `http://localhost:3000/api/sc/search/tracks?q=${encodeURIComponent(q)}&limit=12&client_id=${clientId}`,
  ).catch((e) => ({ status: "ERR " + e.message }));
  console.log("sc search status:", res.status);
  const body = await res.json().catch(() => null);
  const collection = body?.collection ?? [];
  console.log("results:", collection.length);

  let best = null;
  for (const raw of collection) {
    const c = {
      id: `sc:${raw.id ?? raw.urn}`,
      title: raw.title ?? "",
      artist: raw.user?.username ?? "",
      durationMs: raw.full_duration ?? raw.duration ?? 0,
    };
    const s = score(track, c);
    console.log(`  ${s > 0 ? "HIT " : "miss"} score=${s.toFixed(2)} | "${c.title}" | ${c.artist} | ${Math.round(c.durationMs / 1000)}s`);
    if (s > 0 && (!best || s > best.s)) best = { ...c, s };
  }
  console.log("\nBEST:", best ? `${best.id} "${best.title}" (${best.s.toFixed(2)})` : "NO CONFIDENT MATCH");

  if (best) {
    // resolve the stream like resolveSoundCloudStream does
    const sid = best.id.replace(/^sc:/, "");
    const t = await fetch(
      `http://localhost:3000/api/sc/tracks/${sid}?client_id=${clientId}`,
    ).then((r) => r.json()).catch(() => null);
    const prog = t?.media?.transcodings?.find((x) => x.format?.protocol === "progressive" && x.format?.mime_type?.startsWith("audio/mpeg"));
    const hls = t?.media?.transcodings?.find((x) => x.format?.protocol === "hls" && x.format?.mime_type?.startsWith("audio/mpeg"));
    const pick = prog ?? hls;
    console.log("transcoding:", pick ? `${pick.format.protocol} ${pick.format.mime_type} quality=${pick.quality}` : "NONE");
    if (pick?.url) {
      const lr = await fetch(`${pick.url}?client_id=${clientId}`).then((r) => r.json()).catch(() => null);
      const url = lr?.url;
      if (url) {
        const head = await fetch(url, { method: "HEAD" }).catch((e) => ({ status: "ERR " + e.message }));
        console.log("stream HEAD:", head.status, head.headers?.get?.("content-type") ?? "", head.headers?.get?.("content-length") ?? "");
      } else console.log("no url in lookup:", JSON.stringify(lr).slice(0, 200));
    }
  }
}
main();
