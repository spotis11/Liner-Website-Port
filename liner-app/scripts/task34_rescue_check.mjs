// Task 34 round 2: stand-in rescue test with the REAL Liner metadata for the
// three reported tracks (NCS uploads + a Topic upload).
const ORIGIN = "http://localhost:3000";
const realFetch = globalThis.fetch;

const SCRIPT_URL = /src="((?:https:)?\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
const CLIENT_ID_PATTERN = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/;
async function discoverClientId() {
  const home = await (await realFetch(`${ORIGIN}/api/fetch?u=${encodeURIComponent("https://soundcloud.com")}`)).text();
  const urls = [...home.matchAll(SCRIPT_URL)].map((m) => (m[1].startsWith("//") ? `https:${m[1]}` : m[1])).reverse();
  for (const u of urls) {
    try {
      const js = await (await realFetch(`${ORIGIN}/api/fetch?u=${encodeURIComponent(u)}`)).text();
      const id = js.match(CLIENT_ID_PATTERN)?.[1];
      if (id) return id;
    } catch { /* next */ }
  }
  return null;
}

function normalizeForMatch(value) {
  return String(value ?? "").toLowerCase()
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, " ")
    .replace(/\b(feat|ft|featuring|prod|official|video|audio|lyrics?|hd|hq)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}
const tokens = (v) => (normalizeForMatch(v) ? normalizeForMatch(v).split(" ") : []);
function tokenCoverage(wanted, have) {
  if (!wanted.length) return 0;
  const haveSet = new Set(have);
  let hit = 0;
  for (const t of wanted) if (haveSet.has(t)) hit += 1;
  return hit / wanted.length;
}
function compactTitleScore(wanted, have) {
  const c = (v) => normalizeForMatch(v).replace(/\s+/g, "");
  const n = c(wanted), h = c(have);
  if (!n || !h) return 0;
  if (n === h) return 1;
  if (n.length >= 6 && h.includes(n)) return 0.95;
  return 0;
}
function durationScore(wantedMs, candidateMs) {
  if (!wantedMs || !candidateMs) return 0.5;
  const delta = Math.abs(wantedMs - candidateMs);
  const tol = Math.max(wantedMs * 0.35, 45_000);
  if (delta > tol) return 0;
  return 1 - delta / tol;
}
function scoreStandInCandidate(track, candidate) {
  const wantedTitle = tokens(track.title);
  const wantedArtist = tokens(track.artists);
  const haveTitle = tokens(candidate.title);
  const haveArtist = tokens(candidate.artist);
  const titleScore = Math.max(
    tokenCoverage(wantedTitle, haveTitle),
    tokenCoverage(wantedTitle, [...haveTitle, ...haveArtist]),
    compactTitleScore(track.title, `${candidate.title} ${candidate.artist}`),
  );
  const artistScore = wantedArtist.length
    ? Math.max(
        tokenCoverage(wantedArtist, [...haveArtist, ...haveTitle]),
        compactTitleScore(track.artists, `${candidate.artist} ${candidate.title}`),
      )
    : 0.75;
  if (titleScore < 0.6) return 0;
  if (wantedArtist.length && artistScore < 0.5) return 0;
  const duration = durationScore(track.durationMs, candidate.durationMs);
  if (track.durationMs && candidate.durationMs && duration === 0) return 0;
  return titleScore * 2 + artistScore + duration;
}

async function verifyPlayable(clientId, id) {
  const res = await realFetch(`${ORIGIN}/api/sc/tracks/${id}?client_id=${clientId}`);
  if (!res.ok) return `lookup HTTP ${res.status}`;
  const track = await res.json();
  const transcodings = (track.media?.transcodings ?? []).filter((t) =>
    String(t.format?.mime_type ?? "").startsWith("audio/") && t.format?.protocol !== "dash");
  for (const t of transcodings) {
    const streamRes = await realFetch(
      `${ORIGIN}/api/sc${t.url.replace("https://api-v2.soundcloud.com", "")}${t.url.includes("?") ? "&" : "?"}client_id=${clientId}${track.track_authorization ? `&track_authorization=${encodeURIComponent(track.track_authorization)}` : ""}`);
    if (!streamRes.ok) continue;
    const media = await streamRes.json();
    if (!media.url) continue;
    if (t.format.protocol === "progressive") {
      const probe = await realFetch(`${ORIGIN}/api/media?u=${encodeURIComponent(media.url)}`, { headers: { range: "bytes=0-0" } });
      await probe.body?.cancel().catch(() => undefined);
      return `progressive ${t.format.mime_type} -> probe ${probe.status}${probe.status === 206 || probe.status === 200 ? " PLAYABLE" : " REFUSED"}`;
    }
    // HLS: fetch the playlist (no range — mirrors downloadHlsAudio), count segments
    const pl = await realFetch(`${ORIGIN}/api/media?u=${encodeURIComponent(media.url)}`);
    if (!pl.ok) return `hls playlist HTTP ${pl.status}`;
    const text = await pl.text();
    const segments = text.split("\n").filter((l) => l && !l.startsWith("#")).length;
    return `hls ${t.format.mime_type} -> playlist 200 with ${segments} segments PLAYABLE`;
  }
  return "no playable transcodings";
}

const clientId = await discoverClientId();
console.log("clientId:", clientId);
if (!clientId) process.exit(1);

const CASES = [
  {
    label: 'Shivers (Netrum & Halvorsen, NCS)',
    track: { title: "Shivers", artists: "Netrum, Halvorsen", durationMs: 252_000 },
  },
  {
    label: 'Black Sunrise (Andreas Stone, Denniz Jamm, NCS)',
    track: { title: "Black Sunrise", artists: "Andreas Stone, Denniz Jamm", durationMs: 232_000 },
  },
  {
    label: 'Flashback (JD Smith, Topic)',
    track: { title: "Flashback", artists: "JD Smith", durationMs: 264_000 },
  },
];

for (const c of CASES) {
  const q1 = [c.track.title, ...c.track.artists.split(/[,/&]\s*/)].filter(Boolean).join(" ").slice(0, 120);
  const search = async (q) => {
    const res = await realFetch(`${ORIGIN}/api/sc/search/tracks?q=${encodeURIComponent(q)}&limit=12&client_id=${clientId}`);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      collection: (body.collection ?? []).map((t) => ({
        id: String(t.id), title: t.title ?? "", artist: t.user?.username ?? "",
        durationMs: t.full_duration ?? t.duration ?? 0,
      })),
    };
  };
  console.log(`\n=== ${c.label}`);
  let r1 = await search(q1);
  console.log(`    query1 "${q1}": ${r1.error ?? r1.collection.length + " results"}`);
  let best = null;
  for (const cand of r1.collection ?? []) {
    const s = scoreStandInCandidate(c.track, cand);
    if (s > 0 && (!best || s > best.score)) best = { ...cand, score: s };
  }
  let usedFallback = false;
  if (!best) {
    usedFallback = true;
    const r2 = await search(c.track.title.trim());
    console.log(`    query2 (title-only) "${c.track.title}": ${r2.error ?? r2.collection.length + " results"}`);
    for (const cand of r2.collection ?? []) {
      const s = scoreStandInCandidate(c.track, cand);
      if (s > 0 && (!best || s > best.score)) best = { ...cand, score: s };
    }
  }
  if (!best) { console.log("    => NO CONFIDENT MATCH"); continue; }
  console.log(`    => ${usedFallback ? "(title-only fallback) " : ""}match "${best.title}" / ${best.artist} [${Math.round(best.durationMs / 1000)}s] score ${best.score.toFixed(2)}`);
  console.log(`    => ${await verifyPlayable(clientId, best.id)}`);
}
