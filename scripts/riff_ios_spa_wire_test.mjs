// Debug: exact SPA wire format for an IOS profile through :3000 proxy.
// The SPA sends x-liner-user-agent (browser-forbidden UA remapped server-side).
const VIDEO_ID = process.argv[2] || "dQw4w9WgXcQ";
const UA =
  "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

const body = JSON.stringify({
  videoId: VIDEO_ID,
  contentCheckOk: true,
  racyCheckOk: true,
  context: {
    client: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      hl: "en",
      gl: "US",
      osName: "iOS",
      osVersion: "18.3.2.22D60",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
    },
    user: { lockedSafetyMode: false },
  },
});

const headers = {
  "content-type": "application/json",
  accept: "application/json",
  "x-liner-user-agent": UA, // <- SPA convention; proxy maps to real User-Agent
  "x-youtube-client-name": "5",
  "x-youtube-client-version": "20.10.4",
  "x-origin": "https://www.youtube.com",
};

const r = await fetch("http://localhost:3000/api/yt/www/v1/player?prettyPrint=false", {
  method: "POST",
  headers,
  body,
  signal: AbortSignal.timeout(15000),
});
const text = await r.text();
console.log(`HTTP ${r.status}`);
try {
  const data = JSON.parse(text);
  const sd = data.streamingData || {};
  const all = [...(sd.adaptiveFormats || []), ...(sd.formats || [])];
  const audio = all.filter(
    (f) =>
      f &&
      f.url &&
      !f.signatureCipher &&
      !f.cipher &&
      typeof f.mimeType === "string" &&
      f.mimeType.startsWith("audio/"),
  );
  console.log("playability:", data.playabilityStatus?.status, "|", data.playabilityStatus?.reason || "");
  console.log("total formats:", all.length, "| clean audio:", audio.length);
  if (audio.length) {
    const best = audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    console.log("best:", best.itag, best.mimeType.split(";")[0], Math.round((best.bitrate || 0) / 1000) + "k");
    const probe = new URL(best.url);
    probe.searchParams.set("range", "0-0");
    const v = await fetch(probe.toString(), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    await v.body?.cancel().catch(() => {});
    console.log("stream verify:", v.status, v.headers.get("content-type"), "len:", v.headers.get("content-range") || v.headers.get("content-length"));
  }
} catch (e) {
  console.log("non-JSON or error:", text.slice(0, 300), String(e).slice(0, 200));
}
