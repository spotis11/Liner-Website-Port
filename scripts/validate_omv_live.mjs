/**
 * Live validation of the NEW musicVideoVersion matcher against real YT Music
 * payloads. Mapping replicates the app's mappers (videoId, title, artists,
 * duration, musicVideoType → audioVariant); the matcher is copied verbatim
 * from liner-app/src/features/player/engine/musicVideoVersion.ts.
 */
const PROFILE = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20260911.08.00",
  origin: "https://music.youtube.com",
};
const PARAMS = {
  track: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  video: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D",
};

async function search(query, filter) {
  const res = await fetch(`${PROFILE.origin}/youtubei/v1/search?prettyPrint=false`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-youtube-client-name": "67",
      "x-youtube-client-version": PROFILE.clientVersion,
      "x-origin": PROFILE.origin,
    },
    body: JSON.stringify({
      query,
      ...(filter ? { params: PARAMS[filter] } : {}),
      context: {
        client: {
          clientName: PROFILE.clientName,
          clientVersion: PROFILE.clientVersion,
          hl: "en",
          gl: "US",
        },
        user: { lockedSafetyMode: false },
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function collect(node, key, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, key, out);
    return out;
  }
  if (node[key]) out.push(node[key]);
  for (const v of Object.values(node)) collect(v, key, out);
  return out;
}

const parseDurationMs = (value) => {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p)))
    return undefined;
  const n = parts.map(Number);
  const s = n[n.length - 1], m = n[n.length - 2], h = parts.length === 3 ? n[0] : 0;
  if (s > 59 || (parts.length === 3 && m > 59)) return undefined;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total * 1000 : undefined;
};

// map rows like innertubeTrackMapper + audioVariantOf
function mapRows(body) {
  const rows = collect(body, "musicResponsiveListItemRenderer");
  const out = [];
  for (const r of rows) {
    const flex = (i) => r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer;
    const text = (i) => (flex(i)?.text?.runs ?? []).map((x) => x.text).join("");
    const title = text(0);
    if (!title) continue;
    const runs = flex(1)?.text?.runs ?? [];
    const videoId =
      r.playlistItemData?.videoId ??
      flex(0)?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
      r.navigationEndpoint?.watchEndpoint?.videoId;
    if (!videoId) continue;
    // artist run: first run linked to a MUSIC_PAGE_TYPE_ARTIST browse page,
    // else first run text (mirrors runsToArtists/fallback behavior closely
    // enough for validation)
    let artists = [];
    for (const run of runs) {
      const nav = run.navigationEndpoint?.browseEndpoint;
      const pageType =
        run.navigationEndpoint?.watchEndpoint ? undefined : nav ? undefined : undefined;
      const browseId = nav?.browseId;
      if (browseId && /^UC/.test(browseId)) {
        artists.push({ id: browseId, name: run.text });
        break;
      }
    }
    if (artists.length === 0) {
      const seg = text(1).split("•")[0]?.trim();
      if (seg) artists.push({ id: "unknown", name: seg });
    }
    const durationMs = runs.map((r2) => (r2.text ? parseDurationMs(r2.text) : undefined)).find(Boolean) ?? 0;
    const musicVideoType =
      flex(0)?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint
        ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
    const audioVariant = JSON.stringify(r).includes('"MUSIC_VIDEO_TYPE_OMV"')
      ? "music-video"
      : undefined;
    out.push({
      type: "track",
      id: videoId,
      title,
      artists,
      durationMs,
      musicVideoType,
      audioVariant,
    });
  }
  return out;
}

/* ==== matcher copied verbatim from musicVideoVersion.ts ==== */
const normalize = (value) =>
  value.normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const OFFICIAL_MARKERS = /official|music\s*video|videoclip|\bmv\b|m\/v/i;
const DECORATION_JUNK =
  /\blyrics?\b|\bsped\b|\bslowed\b|\breverb\b|\bnightcore\b|\bkaraoke\b|\bcovers?\b|\bcover\s+art\b|\breaction\b|\blive\b|\binstrumental\b|\b8d\b|\bmashup\b|\bfanmade\b|\bfan\s*made\b|\bremix(?:es)?\b|\bbut\s+it\b|\bparody\b|\btutorial\b|\bbeatbox\b/i;
const TITLE_JUNK =
  /\blyrics?\b|\bsped\b|\bslowed\b|\breverb\b|\bnightcore\b|\bkaraoke\b|\b8d\b|\bmashup\b|\bfanmade\b|\bfan\s*made\b|\breaction\b|\bbut\s+it\b|\bparody\b|\bremix(?:es)?\b/i;
const isChannelId = (id) => Boolean(id?.startsWith("UC"));

function titleCandidates(title) {
  let official = false;
  let junk = TITLE_JUNK.test(title);
  let core = title;
  for (const match of title.matchAll(/[([]([^\])}]*)[)\]]/g)) {
    const group = match[1] ?? "";
    if (OFFICIAL_MARKERS.test(group)) { official = true; core = core.replace(match[0], " "); }
    if (DECORATION_JUNK.test(group)) junk = true;
  }
  const segments = core.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    const tail = segments.slice(1).join(" - ");
    if (OFFICIAL_MARKERS.test(tail)) { official = true; core = segments[0]; }
    if (DECORATION_JUNK.test(tail)) junk = true;
  }
  const cores = new Set([core, ...segments].map(normalize));
  return { cores, official, junk };
}

function durationPenalty(videoMs, trackMs) {
  if (videoMs <= 0 || trackMs <= 0) return 0.5;
  if (Math.abs(videoMs - trackMs) > 60_000) return null;
  const diff = Math.abs(videoMs - trackMs);
  if (diff <= 4_000) return 1;
  if (diff <= 10_000) return 0.75;
  return 0.25;
}

function evaluate(result, track, artist, ownVideoId, order) {
  if (result.type !== "track") return null;
  if (result.id === ownVideoId) return null;
  if (result.audioVariant === "premium-only") return null;
  const artistMatch = result.artists.some((candidate) =>
    (isChannelId(artist.id) && artist.id === candidate.id) ||
    normalize(candidate.name) === normalize(artist.name),
  );
  if (!artistMatch) return null;
  const parts = titleCandidates(result.title);
  if (parts.junk) return null;
  if (!parts.cores.has(normalize(track.title))) return null;
  if (result.audioVariant === "music-video") {
    const score = durationPenalty(result.durationMs, track.durationMs);
    return score === null ? null : { id: result.id, tier: 1, score, order };
  }
  if (!parts.official) return null;
  const score = durationPenalty(result.durationMs, track.durationMs);
  return score === null ? null : { id: result.id, tier: 2, score, order };
}

function outranks(candidate, best) {
  if (candidate.tier !== best.tier) return candidate.tier < best.tier;
  if (candidate.score !== best.score) return candidate.score > best.score;
  return candidate.order < best.order;
}

async function resolve(track, ownVideoId) {
  const body = await search(`${track.title} ${track.artist}`, "video");
  const results = mapRows(body);
  const artist = { id: track.artistId, name: track.artist };
  let best = null;
  results.forEach((result, order) => {
    const c = evaluate(result, track, artist, ownVideoId, order);
    if (c && (!best || outranks(c, best))) best = c;
  });
  return { best, results };
}

/* ==== live scenarios ==== */
function log(name, track, ownVideoId, { best, results }) {
  console.log(`\n### ${name}`);
  console.log(
    `  track: "${track.title}" by ${track.artist} (own=${ownVideoId}, dur=${track.durationMs})`,
  );
  if (best) {
    const hit = results[best.order];
    console.log(
      `  → RESOLVED: ${best.id} (tier ${best.tier}, score ${best.score}) = "${hit.title}" [${hit.musicVideoType}] by ${hit.artists[0]?.name}`,
    );
  } else {
    console.log("  → null (fallback to own id)");
  }
}

// 1. Verity Disstrack — ATV song row; fetch it live from the track filter
const songBody = await search("Verity Disstrack", "track");
const songRows = mapRows(songBody).filter(
  (r) => r.musicVideoType === "MUSIC_VIDEO_TYPE_ATV" && normalize(r.title) === "verity disstrack",
);
const song = songRows[0];
if (!song) {
  console.log("Verity ATV song row not found!", songRows.slice(0, 5));
} else {
  const track = {
    id: song.id,
    title: "Verity Disstrack",
    artist: "HaVexy",
    artistId: song.artists.find((a) => isChannelId(a.id))?.id,
    durationMs: song.durationMs,
  };
  console.log(`Verity ATV song row: id=${song.id} dur=${song.durationMs} artistId=${track.artistId}`);
  log("Verity Disstrack (Havexy) — the user's report", track, song.id, await resolve(track, song.id));
}

// 2. Pepas by Farruko (curated OMV path)
{
  const track = { id: "OWNPEPAS000", title: "Pepas", artist: "Farruko", artistId: undefined, durationMs: 248000 };
  log("Pepas (Farruko) — curated OMV path", track, "OWNPEPAS000", await resolve(track, "OWNPEPAS000"));
}

// 3. Negative: sped-up version must not resolve
{
  const track = { id: "33gjH6Mbozk", title: "Verity Disstrack (sped up)", artist: "HaVexy", artistId: undefined, durationMs: 150000 };
  log("Verity Disstrack (sped up) — junk rejection", track, "33gjH6Mbozk", await resolve(track, "33gjH6Mbozk"));
}

// 4. Negative: obscure track with no video at all
{
  const track = { id: "OWNXYZ00000", title: "Xylophone Zenith Quartet", artist: "Nobody Real", artistId: undefined, durationMs: 200000 };
  log("Nonexistent song — should stay null", track, "OWNXYZ00000", await resolve(track, "OWNXYZ00000"));
}
