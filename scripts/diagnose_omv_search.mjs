/**
 * Deep-search diagnostic: replicate the app's innertube search exactly
 * (WEB_REMIX profile, same params) and dump raw payloads for a query.
 * Usage: node scripts/diagnose_omv_search.mjs "Verity Disstrack Havexy"
 */
const QUERY = process.argv[2] ?? "Verity Disstrack Havexy";

const PROFILE = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20260911.08.00",
  origin: "https://music.youtube.com",
};

// Same filter params as innertubeSearch.ts
const PARAMS = {
  track: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  video: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D",
};

async function search(query, filter) {
  const url = `${PROFILE.origin}/youtubei/v1/search?prettyPrint=false`;
  const body = {
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
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-youtube-client-name": "67",
      "x-youtube-client-version": PROFILE.clientVersion,
      "x-origin": PROFILE.origin,
      origin: PROFILE.origin,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`search failed HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Walk every node, collect musicResponsiveListItemRenderer objects
function collectRenderers(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectRenderers(child, out);
    return out;
  }
  if (node.musicResponsiveListItemRenderer) {
    out.push(node.musicResponsiveListItemRenderer);
  }
  for (const value of Object.values(node)) collectRenderers(value, out);
  return out;
}

function flexText(renderer, column) {
  const flex = renderer.flexColumns?.[column]?.musicResponsiveListItemFlexColumnRenderer;
  const runs = flex?.text?.runs ?? [];
  return runs.map((run) => run.text).join("");
}

function describe(renderer) {
  const title = flexText(renderer, 0);
  const subtitle = flexText(renderer, 1);
  const videoId =
    renderer.playlistItemData?.videoId ??
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
      ?.navigationEndpoint?.watchEndpoint?.videoId ??
    renderer.navigationEndpoint?.watchEndpoint?.videoId ??
    null;
  const pageType =
    renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
      ?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType ?? null;
  const raw = JSON.stringify(renderer);
  return { title, subtitle, videoId, pageType, hasOmv: raw.includes("MUSIC_VIDEO_TYPE_OMV"), raw: raw.length };
}

const body = await search(QUERY, "video");
const renderers = collectRenderers(body);
console.log(`\n=== video-filter search: "${QUERY}" — ${renderers.length} item renderers ===`);
for (const r of renderers) {
  const d = describe(r);
  if (!d.title) continue;
  console.log(
    `• ${JSON.stringify(d.title)} | vid=${d.videoId} | type=${d.pageType} | OMV=${d.hasOmv} | sub=${JSON.stringify(d.subtitle.slice(0, 90))}`,
  );
}

// Also unfiltered search to see how the song row itself appears
const bodyAll = await search(QUERY, undefined);
const renderersAll = collectRenderers(bodyAll);
console.log(`\n=== unfiltered search: "${QUERY}" — ${renderersAll.length} item renderers ===`);
for (const r of renderersAll.slice(0, 15)) {
  const d = describe(r);
  if (!d.title) continue;
  console.log(
    `• ${JSON.stringify(d.title)} | vid=${d.videoId} | type=${d.pageType} | OMV=${d.hasOmv} | sub=${JSON.stringify(d.subtitle.slice(0, 90))}`,
  );
}
