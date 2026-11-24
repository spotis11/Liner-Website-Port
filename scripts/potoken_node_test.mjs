// PoToken server-side mint probe (yt-dlp approach): att/get challenge ->
// interpreter -> BotGuard VM snapshot -> GenerateIT -> WebPoMinter.
// bgutils-js runs the VM outside the browser the same way yt-dlp does.
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { GOOG_API_KEY, GOOG_BASE_URL } from "bgutils-js/utils";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const CLIENT_VERSION = "2.20250925.01.00";

// minimal browser-ish globals for the BotGuard VM in node
const stub = { innerWidth: 1280, innerHeight: 720, scrollX: 0, scrollY: 0 };
globalThis.window = globalThis.window ?? globalThis;
try {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
      languages: ["en-US", "en"],
      webdriver: false,
      hardwareConcurrency: 8,
      language: "en-US",
      appVersion: "5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      appName: "Netscape",
      product: "Gecko",
      vendor: "Google Inc.",
      plugins: { length: 0 },
      mimeTypes: { length: 0 },
    },
    configurable: true,
  });
} catch {
  /* navigator already fixed */
}
globalThis.location = globalThis.location ?? { href: "https://music.youtube.com/", protocol: "https:", host: "music.youtube.com", hostname: "music.youtube.com", origin: "https://music.youtube.com", pathname: "/", search: "", hash: "" };
globalThis.document = globalThis.document ?? {
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, attachShadow: () => ({}) }),
  documentElement: stub,
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  referrer: "https://music.youtube.com/",
  hidden: false,
  visibilityState: "visible",
  hasFocus: () => true,
  createEvent: () => ({ initEvent: () => {} }),
  cookie: "",
};
globalThis.screen = globalThis.screen ?? { width: 1280, height: 720, availWidth: 1280, availHeight: 720, colorDepth: 24, pixelDepth: 24 };
globalThis.history = globalThis.history ?? { length: 1, state: null, back: () => {}, forward: () => {}, pushState: () => {}, replaceState: () => {} };
globalThis.self = globalThis.self ?? globalThis;
globalThis.top = globalThis.top ?? globalThis;
globalThis.parent = globalThis.parent ?? globalThis;

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

async function main() {
  const videoId = process.argv[2] || "BI9HQCzpDgQ";
  const t0 = Date.now();

  // 1. challenge
  const attRes = await fetch("https://music.youtube.com/youtubei/v1/att/get?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, "origin": "https://music.youtube.com", "referer": "https://music.youtube.com/" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
      engagementType: "ENGAGEMENT_TYPE_UNBOUND",
    }),
  });
  if (!attRes.ok) throw new Error(`att/get ${attRes.status}`);
  const { bgChallenge } = (await attRes.json());
  if (!bgChallenge) throw new Error("no bgChallenge");
  const script =
    bgChallenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  let url = bgChallenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (url?.startsWith("//")) url = `https:${url}`;
  if (!bgChallenge.program || !bgChallenge.globalName || (!script && !url)) {
    throw new Error(`challenge incomplete: ${JSON.stringify(Object.keys(bgChallenge))}`);
  }

  // 2. interpreter
  const interpreterJs = script || (await (await fetch(url)).text());

  // 3. VM bootstrap
  Function(interpreterJs)();
  const botguard = await BotGuardClient.create({
    globalName: bgChallenge.globalName,
    globalObject: globalThis,
    program: bgChallenge.program,
  });

  // 4. snapshot
  const webPoSignalOutput = [];
  const botguardToken = await botguard.snapshot({ webPoSignalOutput });
  console.log("snapshot token len:", String(botguardToken).length, "| signalOutput:", webPoSignalOutput.map((f) => typeof f));

  // 5. GenerateIT
  const itRes = await fetch(`${GOOG_BASE_URL}/$rpc/google.internal.waa.v1.Waa/GenerateIT`, {
    method: "POST",
    headers: { "content-type": "application/json+protobuf", "x-goog-api-key": GOOG_API_KEY, "x-user-agent": "grpc-web-javascript/0.1" },
    body: JSON.stringify([REQUEST_KEY, botguardToken]),
  });
  if (!itRes.ok) throw new Error(`GenerateIT ${itRes.status}`);
  const arr = (await itRes.json());
  console.log("GenerateIT slots:", arr.map((v) => (v ? (typeof v === "string" ? `str(${v.length})` : v) : "null")));
  const integrityToken = arr[0] || arr[3];
  if (!integrityToken) throw new Error("no integrity token");

  // 6. minter
  const minter = await WebPoMinter.create(
    { integrityToken: integrityToken.replace(/\+/g, "-").replace(/\//g, "_") },
    webPoSignalOutput,
  );
  const poToken = await minter.mintAsWebsafeString(videoId);
  console.log(`PO TOKEN for ${videoId}: len=${poToken.length} head=${poToken.slice(0, 24)} (${Date.now() - t0}ms)`);
}

main().catch((e) => {
  console.error("FAIL:", e.message, e.stack?.split("\n").slice(0, 3).join(" | "));
  process.exit(1);
});
