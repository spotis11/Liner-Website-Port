// Alfredo YouTube Music search — Node edition.
// Mirrors alfredo.py's pipeline: ytmusicapi.search(filter="songs") → videoId.
// Implemented with the WEB_REMIX InnerTube client (same as YTMusic uses
// under the hood). Falls back to yt-dlp ytsearch1 when the parse fails, so
// .playmusic always resolves something playable.
"use strict";

const { execFile } = require("child_process");

const WEB_REMIX = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20260911.08.00",
  origin: "https://music.youtube.com",
};

function log(...parts) {
  console.log(`[ytmsearch] ${new Date().toISOString()}`, ...parts);
}

// alfredo.py _parse_song_query: '<song> (by Artist)' → {song, artist}
function parseSongQuery(query) {
  const q = (query || "").trim();
  let m = q.match(/[(\[]\s*by[:\s]+(.+?)[)\]]\s*$/i);
  if (m) return { song: q.slice(0, m.index).trim().replace(/[\s\-–—|,]+$/, ""), artist: m[1].trim() };
  m = q.match(/^(.*?)\s+by\s+(.+)$/i);
  if (m && m[2].trim().split(/\s+/).length <= 4) return { song: m[1].trim(), artist: m[2].trim() };
  return { song: q, artist: "" };
}

const TITLE_STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "my", "your", "song", "music", "video", "official", "audio", "lyrics", "by"]);

function tokens(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !TITLE_STOPWORDS.has(w));
}

// Simplified port of _score_track: title-token overlap + artist bonus.
function scoreCandidate(cand, qTokens, artist) {
  const tSet = new Set(tokens(cand.title));
  let score = 0;
  if (qTokens.length) {
    for (const t of qTokens) if (tSet.has(t)) score += 1;
    score /= qTokens.length;
  }
  if (artist) {
    const a = artist.toLowerCase();
    if ((cand.artists || "").toLowerCase().includes(a)) score += 0.6;
    else if (a.split(/\s+/).every((w) => (cand.artists || "").toLowerCase().includes(w))) score += 0.35;
    else score -= 0.25;
  }
  if (cand.isVideo) score += 0.05;
  if (cand.duration > 0 && cand.duration > 1800) score -= 1; // hour+ mixes are rarely what was asked
  return score;
}

function parseDuration(text) {
  const m = String(text || "").match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  return m[3] !== undefined
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    : Number(m[1]) * 60 + Number(m[2]);
}

// Recursively collect musicResponsiveListItemRenderer rows.
function collectRows(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectRows(item, out);
    return;
  }
  if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer);
  for (const key of Object.keys(node)) {
    if (key === "musicResponsiveListItemRenderer") continue;
    collectRows(node[key], out);
  }
}

function columnText(row, index) {
  const col = row.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text;
  const runs = col?.runs || (col?.simpleText ? [{ text: col.simpleText }] : []);
  return runs.map((r) => r.text || "").join("").trim();
}

function rowVideoId(row) {
  return (
    row?.playlistItemData?.videoId ||
    row?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
    row?.menu?.menuRenderer?.items?.find((i) => i?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint)?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId ||
    row?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    null
  );
}

function rowIsVideo(row) {
  return columnText(row, 2).toLowerCase().startsWith("video");
}

async function ytmSearch(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(`${WEB_REMIX.origin}/youtubei/v1/search?prettyPrint=false`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-origin": WEB_REMIX.origin,
        "x-youtube-client-name": "67",
        "x-youtube-client-version": WEB_REMIX.clientVersion,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      body: JSON.stringify({
        query,
        context: { client: { ...WEB_REMIX, hl: "en", gl: "US" }, user: { lockedSafetyMode: false } },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rows = [];
    collectRows(data, rows);
    const candidates = [];
    for (const row of rows) {
      const videoId = rowVideoId(row);
      const title = columnText(row, 0);
      if (!videoId || !title) continue;
      const subtitle = columnText(row, 1);
      // "Artist • Album • year" or "video • 3:45" — artists is the first segment
      const parts = subtitle.split(" • ").map((p) => p.trim()).filter(Boolean);
      const artists = parts[0] || "Unknown";
      const duration = parseDuration(parts.find((p) => /^\d+(:\d{2}){1,2}$/.test(p)));
      candidates.push({ videoId, title, artists, duration, isVideo: rowIsVideo(row) });
    }
    return candidates;
  } finally {
    clearTimeout(timer);
  }
}

// yt-dlp search fallback: returns [{videoId,title,artists,duration}]
function ytSearchFallback(query) {
  return new Promise((resolve) => {
    execFile("yt-dlp", ["--no-warnings", "--socket-timeout", "12", "--flat-playlist", "-J", `ytsearch3:${query}`], { timeout: 45000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const info = JSON.parse(stdout);
        const entries = Array.isArray(info?.entries) ? info.entries : [];
        resolve(
          entries
            .filter((e) => e?.id)
            .map((e) => ({ videoId: e.id, title: e.title || "Unknown", artists: e.uploader || e.channel || "Unknown", duration: Number(e.duration) || 0, isVideo: true })),
        );
      } catch {
        resolve([]);
      }
    });
  });
}

// Main entry: best candidate for a .playmusic query. Never throws.
async function searchTrack(query) {
  const { song, artist } = parseSongQuery(query);
  const searchQ = artist ? `${song} ${artist}` : song;
  const qTokens = tokens(song);
  let candidates = [];
  try {
    candidates = await ytmSearch(searchQ);
    log(`ytm ${candidates.length} candidates for ${JSON.stringify(searchQ)}`);
  } catch (err) {
    log("ytm search failed:", err.message);
  }
  if (!candidates.length) {
    candidates = await ytSearchFallback(searchQ);
    log(`yt-dlp fallback ${candidates.length} candidates`);
  }
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const cand of candidates) {
    const s = scoreCandidate(cand, qTokens, artist);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  log(`picked ${JSON.stringify(best.title)} score=${bestScore.toFixed(2)}`);
  return best;
}

module.exports = { searchTrack, parseSongQuery };
