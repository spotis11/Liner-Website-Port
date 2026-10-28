// Task 34: mirror resolveSoundCloudStandIn end-to-end through the web proxy
// for the reported failing tracks, using plausible Liner metadata variants.
//   node task34_soundcloud.mjs
const ORIGIN = "http://localhost:3000";

// ---- rewriteForWeb mirror (soundcloud hosts) -------------------------------
const FETCH_HOSTS = ["soundcloud.com", "a-v2.sndcdn.com", "www.youtube.com", "youtube.com"];
const MEDIA_HOSTS = ["googlevideo.com", "sndcdn.com", "tryliner.fun", "r2.dev", "soundcloud.com"];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!raw || raw.startsWith("/") || raw.startsWith("blob:") || raw.startsWith("data:"))
    return realFetch(input, init);
  let url;
  try { url = new URL(raw); } catch { return realFetch(input, init); }
  if (url.origin === ORIGIN) return realFetch(input, init);
  const host = url.hostname;
  const m = (s) => host === s || host.endsWith("." + s);
  if (host === "api-v2.soundcloud.com") return realFetch(`${ORIGIN}/api/sc${url.pathname}${url.search}`, init);
  if (m("a-v2.sndcdn.com")) return realFetch(`${ORIGIN}/api/fetch?u=${encodeURIComponent(url.toString())}`, init);
  if (MEDIA_HOSTS.some((s) => m(s))) return realFetch(`${ORIGIN}/api/media?u=${encodeURIComponent(url.toString())}`, init);
  if (FETCH_HOSTS.some((s) => m(s))) return realFetch(`${ORIGIN}/api/fetch?u=${encodeURIComponent(url.toString())}`, init);
  return realFetch(input, init);
};

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

// ---- soundcloudMappers/score mirror ----------------------------------------
function normalizeForMatch(value) {
  return String(value ?? "")
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

async function scSearch(clientId, query) {
  const u = `${ORIGIN}/api/sc/search/tracks?q=${encodeURIComponent(query)}&limit=12&client_id=${clientId}`;
  const res = await realFetch(u);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const body = await res.json();
  return {
    collection: (body.collection ?? []).map((t) => ({
      id: String(t.id),
      title: t.title ?? "",
      artist: t.user?.username ?? "",
      durationMs: t.full_duration ?? t.duration ?? 0,
      policy: t.policy ?? "",
      playable: t.playable !== false,
    })),
  };
}

async function resolveStream(clientId, id) {
  const u = `${ORIGIN}/api/sc/tracks/${id}?client_id=${clientId}`;
  const res = await realFetch(u);
  if (!res.ok) return `track lookup HTTP ${res.status}`;
  const track = await res.json();
  const transcodings = (track.media?.transcodings ?? []).filter((t) =>
    String(t.format?.mime_type ?? "").startsWith("audio/") && t.format?.protocol !== "dash",
  );
  for (const t of transcodings) {
    try {
      const streamRes = await realFetch(
        `${ORIGIN}/api/sc${t.url.replace("https://api-v2.soundcloud.com", "")}${t.url.includes("?") ? "&" : "?"}client_id=${clientId}${track.track_authorization ? `&track_authorization=${encodeURIComponent(track.track_authorization)}` : ""}`,
      );
      if (!streamRes.ok) continue;
      const media = await streamRes.json();
      if (!media.url) continue;
      const probe = await realFetch(`${ORIGIN}/api/media?u=${encodeURIComponent(media.url)}`, { method: "GET", headers: { range: "bytes=0-0" } });
      await probe.body?.cancel().catch(() => undefined);
      return `${t.format.protocol}/${t.format.mime_type} -> probe ${probe.status}${probe.status === 200 || probe.status === 206 ? " (playable!)" : " << REFUSED"}`;
    } catch (e) {
      return `threw ${String(e).slice(0, 80)}`;
    }
  }
  return "no playable transcodings";
}

const clientId = await discoverClientId();
console.log("soundcloud clientId:", clientId ?? "NOT FOUND");
if (!clientId) process.exit(1);

// the three reported tracks with plausible Liner metadata variants
const CASES = [
  { label: 'Shivers (jujubotv) as "Shivers"', track: { title: "Shivers", artists: "", durationMs: 0 } },
  { label: 'Shivers artist=JuJuBoTV', track: { title: "Shivers", artists: "JuJuBoTV", durationMs: 0 } },
  { label: 'Blacksunrise as "Blacksunrise"', track: { title: "Blacksunrise", artists: "", durationMs: 0 } },
  { label: 'Blacksunrise as "Black Sunrise"', track: { title: "Black Sunrise", artists: "", durationMs: 0 } },
  { label: 'Flashback title="Flashback - JD Smith" artist=Bitpull', track: { title: "Flashback - JD Smith", artists: "Bitpull", durationMs: 0 } },
  { label: 'Flashback title="Flashback" artist=JD Smith', track: { title: "Flashback", artists: "JD Smith", durationMs: 0 } },
  { label: 'Flashback title="Flashback" artist=Bitpull', track: { title: "Flashback", artists: "Bitpull", durationMs: 0 } },
];

for (const c of CASES) {
  const query = [c.track.title, ...c.track.artists.split(/[,/&]\s*/).filter(Boolean)].join(" ").slice(0, 120);
  const search = await scSearch(clientId, query);
  console.log(`\n=== ${c.label}\n    query: "${query}"`);
  if (search.error) { console.log(`    search failed: ${search.error}`); continue; }
  if (!search.collection.length) { console.log("    no search results"); continue; }
  let best = null;
  for (const candidate of search.collection) {
    const score = scoreStandInCandidate(c.track, candidate);
    if (score > 0 && (!best || score > best.score)) best = { ...candidate, score };
  }
  console.log(`    results: ${search.collection.length}, top raw: ${search.collection
    .slice(0, 3)
    .map((r) => `"${r.title}" / ${r.artist} [${Math.round(r.durationMs / 1000)}s]`)
    .join(" | ")}`);
  if (!best) { console.log("    => NO CONFIDENT MATCH (stand-in would fail)"); continue; }
  console.log(`    => match: "${best.title}" / ${best.artist} score ${best.score.toFixed(2)}`);
  console.log(`    => stream: ${await resolveStream(clientId, best.id)}`);
}
