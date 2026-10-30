const done = (line) => { document.getElementById("status").textContent = line; document.title = line; };
const old = window.onYouTubeIframeAPIReady;
window.onYouTubeIframeAPIReady = () => {
  old && old();
  try {
    new YT.Player(document.getElementById("host"), {
      videoId: "wcudhZorXmo",
      playerVars: { mute: 1, autoplay: 0, controls: 0, rel: 0, iv_load_policy: 3, playsinline: 1, origin: window.location.origin, enablejsapi: 1 },
      events: {
        onReady: (e) => done("READY state=" + e.target.getPlayerState()),
        onError: (e) => done("YT_ERROR code=" + e.data),
      },
    });
    done("player constructing…");
  } catch (err) { done("PLAYER threw: " + err.message); }
};
const s = document.createElement("script");
s.src = "https://www.youtube.com/iframe_api";
s.async = true;
s.onerror = () => done("BLOCKED: iframe_api script refused by CSP");
document.head.appendChild(s);
setTimeout(() => { if (document.title.indexOf("probe") >= 0) done("TIMEOUT: api never ready"); }, 15000);
