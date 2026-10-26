const CID = process.argv[2] ?? "3GKD969NJWD1eB6gvQJN0GnueYbcWszv";
const id = process.argv[3] ?? "934568899";
const t = await fetch(`http://localhost:3000/api/sc/tracks/${id}?client_id=${CID}`)
  .then((r) => r.json())
  .catch((e) => ({ err: e.message }));
const transcodings = t.media?.transcodings ?? t.transcodings ?? [];
console.log("policy:", t.policy, "| streamable:", t.streamable, "| duration:", t.duration, "| full:", t.full_duration);
for (const tr of transcodings) {
  console.log(`- ${tr.format?.protocol} | ${tr.format?.mime_type} | preset=${tr.preset} | quality=${tr.quality} | snipped=${tr.snipped} | url=${tr.url ? "yes" : "no"}`);
}
// try resolving the lookup URL for each transcoding
for (const tr of transcodings) {
  if (!tr.url) continue;
  const lookup = await fetch(`${tr.url}${tr.url.includes("?") ? "&" : "?"}client_id=${CID}`)
    .then((r) => r.json())
    .catch((e) => ({ err: e.message }));
  const url = lookup.url;
  console.log(`\nlookup ${tr.format?.protocol}/${tr.format?.mime_type}: ${url ? "GOT URL" : JSON.stringify(lookup).slice(0, 160)}`);
  if (url) {
    if (tr.format?.protocol === "hls") {
      const pl = await fetch(url).then((r) => r.text());
      const seg = pl.split("\n").find((l) => l && !l.startsWith("#"));
      console.log("  playlist first lines:", pl.slice(0, 120).replace(/\n/g, " | "));
      console.log("  first segment:", seg ? seg.slice(0, 90) : "none");
      if (seg) {
        const segUrl = new URL(seg, url).toString();
        const head = await fetch(segUrl, { method: "HEAD" }).catch((e) => ({ status: "ERR " + e.message }));
        console.log("  segment HEAD:", head.status, head.headers?.get?.("content-type") ?? "");
      }
    } else {
      const head = await fetch(url, { method: "HEAD" }).catch((e) => ({ status: "ERR " + e.message }));
      console.log("  HEAD:", head.status, head.headers?.get?.("content-type") ?? "", head.headers?.get?.("content-length") ?? "");
    }
  }
}
