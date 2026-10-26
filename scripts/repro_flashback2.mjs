// Run the app's real WEB_REMIX flow for "Flashback by JD Smith" using the
// same youtubei.js the SPA ships, plus the shell's server-side PO minting.
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/liner-app/package.json");
const { Innertube, Platform } = require("youtubei.js");

Platform.shim.eval = async (data, env) => {
  const args = [env.n, env.sp, env.sig].map((v) => JSON.stringify(v ?? ""));
  return new Function(`${data.output}\nreturn process(${args.join(",")});`)();
};

const SHELL = "http://localhost:3000";

async function main() {
  console.log("creating innertube session (generate_session_locally)…");
  const innertube = await Innertube.create({
    generate_session_locally: true,
    retrieve_player: true,
  });
  console.log("session ok, visitorData:", (innertube.session.context?.client?.visitorData ?? "none")?.slice(0, 30));

  const query = process.argv[2] ?? "flashback jd smith";
  console.log(`searching: "${query}"`);
  const res = await innertube.search(query, { type: "song" }).catch((e) => {
    console.log("song search failed:", e.message);
    return null;
  });
  const tracks = [];
  for (const item of res?.results ?? []) {
    const vid = item?.video_id ?? item?.id;
    const title = item?.title ?? item?.name;
    const author = item?.author?.name ?? item?.author;
    if (vid && title) tracks.push({ vid, title, author: typeof author === "string" ? author : author?.name });
  }
  // fallback: generic search shape
  if (!tracks.length && res?.contents) {
    const flat = JSON.stringify(res.contents);
    const ids = [...flat.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((m) => m[1]);
    console.log("raw videoIds:", [...new Set(ids)].slice(0, 10).join(", "));
  }
  tracks.slice(0, 10).forEach((t, i) => console.log(`  [${i}] ${t.vid} | ${t.title} | ${t.author ?? "?"}`));

  const wanted = tracks.find((t) => /flashback/i.test(t.title) && /smith/i.test(`${t.author}`)) ?? tracks[0];
  if (!wanted) {
    console.log("NO TRACK FOUND");
    return;
  }
  const videoId = process.argv[3] ?? wanted.vid;
  console.log(`\n=== testing playback for: ${videoId} (${wanted.title} — ${wanted.author})`);

  console.log("minting PO token via shell…");
  const pr = await fetch(`${SHELL}/api/po-token?videoId=${videoId}`);
  const pj = await pr.json().catch(() => ({}));
  if (!pr.ok || !pj.poToken) {
    console.log("PO MINT FAILED:", pr.status, JSON.stringify(pj).slice(0, 300));
  } else {
    console.log(`PO token ok (len ${String(pj.poToken).length})`);
  }

  if (pj.poToken) {
    console.log("\ngetBasicInfo(client=YTMUSIC, po_token) — the app's exact call:");
    try {
      const info = await innertube.getBasicInfo(videoId, { client: "YTMUSIC", po_token: pj.poToken });
      const st = info.playability_status?.status;
      console.log("playability:", st, "|", info.playability_status?.reason ?? "");
      const audio = (info.streaming_data?.adaptive_formats ?? []).filter((f) => f.has_audio && !f.has_video);
      console.log("audio formats:", audio.length, audio.slice(0, 3).map((f) => `${f.itag}:${f.mime_type.split(";")[0]}:${f.bitrate}`).join(", "));
      if (audio.length) {
        const src = audio[0];
        const url0 = await src.decipher(innertube.session.player);
        const u = new URL(url0);
        u.searchParams.set("pot", pj.poToken);
        const head = await fetch(u.toString(), { method: "HEAD" }).catch((e) => ({ status: "ERR " + e.message }));
        console.log("stream HEAD:", head.status, head.headers?.get?.("content-type") ?? "", head.headers?.get?.("content-length") ?? "");
      }
    } catch (e) {
      console.log("WEB_REMIX FAILED:", e.message);
    }
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
