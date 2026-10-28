// Task 26: end-to-end WEB_REMIX simulation for "Flashback" by JD Smith.
// Runs in Node with youtubei.js + the shell's PO token, exactly like
// webRemixAudio.resolveWebRemixAudioStream().
import { Innertube, Platform } from "youtubei.js/web";
import { readFileSync } from "node:fs";

const VIDEO_IDS = ["VrZpGEO_o5Q", "R4EKv2uoOJc"];

Platform.shim.eval = async (data, env) => {
  const args = [env.n, env.sp, env.sig].map((v) => JSON.stringify(v ?? ""));
  return new Function(`${data.output}\nreturn process(${args.join(", ")});`)();
};

async function mintPoToken(videoId) {
  const res = await fetch(
    `http://localhost:3000/api/po-token?videoId=${encodeURIComponent(videoId)}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new Error(`po-token ${res.status}`);
  const body = await res.json();
  if (!body.poToken) throw new Error("empty po token");
  return body.poToken;
}

// visitor data — the app gets this from its visitor session; generate locally
async function main() {
  for (const videoId of VIDEO_IDS) {
    console.log(`\n=== ${videoId} ===`);
    try {
      const poToken = await mintPoToken(videoId);
      console.log("po token: minted");
      const innertube = await Innertube.create({
        generate_session_locally: true,
        retrieve_player: true,
        fetch: (input, init) => fetch(input, init),
      });
      const info = await innertube.getBasicInfo(videoId, {
        client: "YTMUSIC",
        po_token: poToken,
      });
      const status = info.playability_status?.status;
      console.log(`playability: ${status} ${(info.playability_status?.reason ?? "")}`);
      const audio = (info.streaming_data?.adaptive_formats ?? []).filter(
        (f) => f.has_audio && !f.has_video && f.mime_type?.startsWith("audio/"),
      );
      console.log(`audio formats: ${audio.length}`);
      if (audio.length) {
        const best = audio[audio.length - 1];
        const deciphered = await best.decipher(innertube.session.player);
        const url = new URL(deciphered);
        url.searchParams.set("pot", poToken);
        console.log(`stream url host: ${url.host}`);
        // probe reachability like assertStreamReachable
        const probe = await fetch(url.toString(), {
          method: "GET",
          headers: { Range: "bytes=0-1023" },
        });
        console.log(`stream probe: ${probe.status} (${probe.headers.get("content-type")})`);
        probe.body?.cancel?.();
      }
    } catch (error) {
      console.log(`FAILED: ${error.message ?? error}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
