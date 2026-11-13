// One-off: find the YouTube Music videoId for s0rrow - i have no friends
const BODY = {
  context: {
    client: { clientName: "WEB_REMIX", clientVersion: "1.20260911.08.00", hl: "en" },
  },
  query: "s0rrow i have no friends",
};
const res = await fetch(
  "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-youtube-client-name": "67",
      "x-youtube-client-version": "1.20260911.08.00",
      origin: "https://music.youtube.com",
    },
    body: JSON.stringify(BODY),
  },
);
const text = await res.text();
console.log("status:", res.status, "bytes:", text.length);
const ids = [...text.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(
  (m) => m[1],
);
console.log("first videoIds:", [...new Set(ids)].slice(0, 5));
const titles = [...text.matchAll(/"title":\{"runs":\[\{"text":"([^"]{0,60})"/g)].map(
  (m) => m[1],
);
console.log("titles:", titles.slice(0, 6));
