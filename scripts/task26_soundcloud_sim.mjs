// Task 26: pure-JS simulation of the SoundCloud stand-in rescue (no app imports).
// Replicates: soundcloudClientId discovery → /search/tracks → scoring → stream resolve.
const SOUNDCLOUD_HOME = "https://soundcloud.com";
const SOUNDCLOUD_API = "https://api-v2.soundcloud.com";
const SCRIPT_URL = /src="((?:https:)?\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
const CLIENT_ID_PATTERN = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/;

// Liner catalog metadata for the failing track (duration 4:24 per YouTube/topic)
const TRACK = { title: "Flashback", artists: "JD Smith", durationMs: 4 * 60_000 + 24_000 };

async function tryFetchText(url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

async function discoverClientId() {
  const html = await tryFetchText(SOUNDCLOUD_HOME, { accept: "text/html,application/xhtml+xml" });
  const urls = [...html.matchAll(SCRIPT_URL)].map((m) => (m[1].startsWith("//") ? `https:${m[1]}` : m[1])).reverse();
  for (const u of urls) {
    const found = (await tryFetchText(u)).match(CLIENT_ID_PATTERN)?.[1];
    if (found) return found;
  }
  throw new Error("no client id found");
}

// exact copies from soundcloudStandIn.ts
function normalizeForMatch(value) {
  return value
    .toLowerCase()
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, " ")
    .replace(/\b(feat|ft|featuring|prod|official|video|audio|lyrics?|hd|hq)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(value) {
  const n = normalizeForMatch(value);
  return n ? n.split(" ") : [];
}
function tokenCoverage(wanted, have) {
  if (!wanted.length) return 0;
  const haveSet = new Set(have);
  let hit = 0;
  for (const t of wanted) if (haveSet.has(t)) hit += 1;
  return hit / wanted.length;
}
function durationScore(wantedMs, candidateMs) {
  if (!wantedMs || !candidateMs) return 0.5;
  const delta = Math.abs(wantedMs - candidateMs);
  const tolerance = Math.max(wantedMs * 0.35, 45_000);
  if (delta > tolerance) return 0;
  return 1 - delta / tolerance;
}
function scoreStandInCandidate(track, candidate) {
  const wantedTitle = tokens(track.title);
  const wantedArtist = tokens(track.artists);
  const haveTitle = tokens(candidate.title);
  const haveArtist = tokens(candidate.artist);
  const titleScore = Math.max(
    tokenCoverage(wantedTitle, haveTitle),
    tokenCoverage(wantedTitle, [...haveTitle, ...haveArtist]),
  );
  const artistScore = wantedArtist.length
    ? tokenCoverage(wantedArtist, [...haveArtist, ...haveTitle])
    : 0.75;
  if (titleScore < 0.6) return 0;
  if (wantedArtist.length && artistScore < 0.5) return 0;
  const duration = durationScore(track.durationMs, candidate.durationMs);
  if (track.durationMs && candidate.durationMs && duration === 0) return 0;
  return titleScore * 2 + artistScore + duration;
}
function standInQuery(track) {
  const artists = track.artists.split(/[,/&]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 2);
  return [track.title, ...artists].filter(Boolean).join(" ").slice(0, 120);
}

async function main() {
  const clientId = await discoverClientId();
  console.log("client id:", clientId);

  const query = standInQuery(TRACK);
  console.log("query:", JSON.stringify(query));
  const searchUrl = `${SOUNDCLOUD_API}/search/tracks?q=${encodeURIComponent(query)}&limit=12&client_id=${clientId}`;
  const res = await fetch(searchUrl);
  console.log("search status:", res.status);
  const body = await res.json();
  const collection = body.collection ?? [];
  console.log(`results: ${collection.length}`);

  const candidates = [];
  for (const t of collection) {
    const candidate = {
      id: `sc:${t.id ?? t.urn ?? ""}`,
      title: t.title ?? "",
      artist: (t.publisher_metadata?.artist ?? t.user?.username ?? ""),
      durationMs: t.duration ?? 0, // mapper uses track.duration (ms)
      fullDurationMs: t.full_duration ?? null,
      policy: t.policy ?? null,
      streamable: t.streamable ?? null,
    };
    candidates.push(candidate);
    const m = Math.floor(candidate.durationMs / 60000);
    const s = Math.floor((candidate.durationMs % 60000) / 1000);
    console.log(`  - "${candidate.title}" | ${candidate.artist} | ${m}:${String(s).padStart(2, "0")} | policy=${candidate.policy} | id=${candidate.id}`);
  }

  let best = null;
  for (const c of candidates) {
    const score = scoreStandInCandidate(TRACK, c);
    console.log(`     score: ${score.toFixed(3)}`);
    if (score > 0 && (!best || score > best.score)) best = { ...c, score };
  }
  console.log("\nBEST:", best ? JSON.stringify(best) : "NONE — gate rejected all candidates");

  if (best) {
    // resolve stream like resolveSoundCloudStream does
    const numericId = best.id.replace(/^sc:/, "");
    const trackUrl = `${SOUNDCLOUD_API}/tracks/${numericId}?client_id=${clientId}`;
    const trackRes = await fetch(trackUrl);
    console.log("\ntrack fetch:", trackRes.status);
    const track = await trackRes.json();
    console.log("track policy:", track.policy, "| streamable:", track.streamable, "| duration:", track.full_duration_ms);
    const transcodingUrl = (track.media?.transcodings ?? []).find((t) => t.format.protocol === "progressive" || t.format.protocol === "hls");
    console.log("transcodings:", (track.media?.transcodings ?? []).map((t) => `${t.format.protocol}/${t.format.mime_type}`).join(", "));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("fatal:", e.message ?? e);
  process.exit(1);
});
