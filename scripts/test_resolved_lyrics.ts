// End-to-end proof: resolve "earrings" via YT Music innertube search, then
// fetch upstream lyrics with that REAL 11-char id — expect polaris mono
// word-level TTML + provider options.
// Run: LINER_SERVICE_* set, then: npx tsx scripts/test_resolved_lyrics.ts
import { signUpstreamRequest } from "../src/lib/upstreamSigner";

const UPSTREAM = "https://api.tryliner.fun";
const CLIENT_VERSION = "1.0.4-desktop";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";

async function signedLogin(): Promise<string | null> {
  const email = process.env.LINER_SERVICE_EMAIL?.trim();
  const pass = process.env.LINER_SERVICE_PASS;
  if (!email || !pass) throw new Error("LINER_SERVICE_* not set");
  const body = JSON.stringify({ email, password: pass });
  const res = await fetch(`${UPSTREAM}/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": UA,
      "x-client-version": CLIENT_VERSION,
      "x-platform": "web",
      ...signUpstreamRequest("POST", "/v1/auth/login", body),
    },
    body,
    redirect: "manual",
  });
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken ?? null;
}

/** YT Music innertube search → best track's 11-char videoId. */
async function resolveYtmTrackId(
  title: string,
  artist: string,
): Promise<string | null> {
  const query = `${title} ${artist}`.trim();
  const res = await fetch(
    "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://music.youtube.com",
        referer: "https://music.youtube.com/",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20260911.08.00",
            hl: "en",
            gl: "US",
          },
        },
        query,
        params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D", // songs filter
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  // walk for musicResponsiveListItemRenderer with a watchEndpoint videoId
  const found: Array<{ id: string; label: string }> = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (obj.watchEndpoint && typeof obj.watchEndpoint === "object") {
        const vid = (obj.watchEndpoint as Record<string, unknown>).videoId;
        if (typeof vid === "string" && /^[A-Za-z0-9_-]{11}$/.test(vid)) {
          const label =
            (obj.accessibilityPlayData as Record<string, unknown> | undefined)
              ? ((obj.accessibilityPlayData as Record<string, { accessibilityData?: { label?: string } }>).accessibilityData?.label)
              : undefined;
          if (!found.some((f) => f.id === vid)) {
            found.push({ id: vid, label: typeof label === "string" ? label : "" });
          }
        }
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(body);
  if (found.length === 0) return null;
  // prefer exact "Play <title> - <artist>" labels
  const want = `play ${title} ${artist}`.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const scored = found.map((f) => {
    const got = f.label.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    let score = 0;
    if (got === want) score = 100;
    else if (got.includes(want) || want.includes(got)) score = 70;
    if (got.startsWith("play ")) score += 5;
    return { ...f, score };
  });
  scored.sort((a, b) => b.score - a.score);
  console.log("   ytm candidates:", scored.slice(0, 3).map((s) => `${s.id} (${s.label || "?"})`).join(" | "));
  return scored[0].id;
}

async function main() {
  const token = await signedLogin();
  if (!token) {
    console.log("service login FAILED");
    process.exit(1);
  }
  console.log("service login: OK");

  const ytid = await resolveYtmTrackId("earrings", "malcolm todd");
  console.log("resolved ytm id:", ytid);
  if (!ytid) process.exit(1);

  const path = `/v1/tracks/${ytid}/lyrics?title=${encodeURIComponent("earrings")}&artist=${encodeURIComponent("malcolm todd")}`;
  const res = await fetch(`${UPSTREAM}${path}`, {
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "user-agent": UA,
      "x-client-version": CLIENT_VERSION,
      "x-platform": "web",
      ...signUpstreamRequest("GET", path),
    },
    redirect: "manual",
  });
  console.log("upstream lyrics (resolved id):", res.status, res.headers.get("content-type"));
  const text = await res.text();
  const providers = [...new Set([...text.matchAll(/"provider":"([^"]+)"/g)].map((m) => m[1]))];
  const syncs = [...new Set([...text.matchAll(/"syncLevel":"([^"]+)"/g)].map((m) => m[1]))];
  console.log("providers:", providers.join(", ") || "(none)");
  console.log("syncLevels:", syncs.join(", ") || "(none)");
  console.log("first 400 chars:", text.slice(0, 400).replace(/\n/g, " "));
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
