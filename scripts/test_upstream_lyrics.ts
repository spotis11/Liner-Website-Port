// Upstream lyrics resolution test — does a LOCAL track id (audius/local feed
// track) miss the upstream Polaris Mono lyrics, and does resolving the real
// upstream track id via catalog search fix it?
//
// Run: npx tsx scripts/test_upstream_lyrics.ts
import { signUpstreamRequest } from "../src/lib/upstreamSigner";

const UPSTREAM = "https://api.tryliner.fun";
const CLIENT_VERSION = "1.0.4-desktop";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36";

function env(k: string): string {
  return (
    process.env[k]?.trim() ?? ""
  );
}

async function signedLogin(): Promise<string | null> {
  const email = env("LINER_SERVICE_EMAIL");
  const pass = env("LINER_SERVICE_PASS");
  if (!email || !pass) throw new Error("LINER_SERVICE_* not set");
  const body = JSON.stringify({ email, password: pass });
  const signed = signUpstreamRequest("POST", "/v1/auth/login", body);
  const res = await fetch(`${UPSTREAM}/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": UA,
      "x-client-version": CLIENT_VERSION,
      "x-platform": "web",
      ...signed,
    },
    body,
    redirect: "manual",
  });
  if (!res.ok) {
    console.log("login failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken ?? null;
}

function signedGet(path: string, token: string): Promise<Response> {
  const signed = signUpstreamRequest("GET", path);
  return fetch(`${UPSTREAM}${path}`, {
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "user-agent": UA,
      "x-client-version": CLIENT_VERSION,
      "x-platform": "web",
      ...signed,
    },
    redirect: "manual",
  });
}

function summarize(label: string, text: string) {
  const providers = [...new Set([...text.matchAll(/"provider":"([^"]+)"/g)].map((m) => m[1]))];
  const syncs = [...new Set([...text.matchAll(/"syncLevel":"([^"]+)"/g)].map((m) => m[1]))];
  console.log(`   ${label} providers: [${providers.join(", ")}] syncLevels: [${syncs.join(", ")}]`);
}

async function main() {
  const token = await signedLogin();
  if (!token) process.exit(1);
  console.log("service login: OK");

  // The track as the pre-loaded/local feed presents it (from earlier repro:
  // audius id ygGw7wr, title "Malcolm Todd - Earrings", artist "worthless nobody")
  const localId = "ygGw7wr";
  const hint = `?title=${encodeURIComponent("earrings")}&artist=${encodeURIComponent("malcolm todd")}&durationMs=151000`;

  // ---- A. lyrics with the LOCAL id (what the relay does today) ----
  const a = await signedGet(`/v1/tracks/${encodeURIComponent(localId)}/lyrics${hint}`, token);
  console.log(`A. upstream lyrics w/ LOCAL id '${localId}':`, a.status, a.headers.get("content-type"));
  const aText = await a.text();
  summarize("A", aText);
  console.log("   sample:", aText.slice(0, 300).replace(/\n/g, " "));

  // ---- B. resolve the REAL upstream track id via catalog search ----
  let tracks: Array<Record<string, unknown>> = [];
  for (const q of ["earrings malcolm todd", "earrings", "malcolm todd"]) {
    const b = await signedGet(`/v1/catalog/search?q=${encodeURIComponent(q)}&limit=10`, token);
    console.log(`B. catalog search "${q}":`, b.status);
    if (b.status !== 200) {
      console.log("   body:", (await b.text()).slice(0, 150).replace(/\n/g, " "));
      continue;
    }
    const search = (await b.json()) as { tracks?: Array<Record<string, unknown>> };
    tracks = search.tracks ?? [];
    for (const t of tracks.slice(0, 5)) {
      console.log("   hit:", t.id, "|", t.title, "|", JSON.stringify(t.artists ?? t.artist ?? "").slice(0, 80), "| dur:", t.durationMs ?? t.duration);
    }
    if (tracks.length > 0) break;
  }
  const hit =
    tracks.find((t) =>
      String(t.title ?? "").toLowerCase().includes("earring")) ?? tracks[0];
  if (!hit) {
    console.log("   no upstream hits");
    return;
  }
  const realId = String(hit.id);

  // ---- C. lyrics with the RESOLVED upstream id ----
  const c = await signedGet(`/v1/tracks/${encodeURIComponent(realId)}/lyrics?title=${encodeURIComponent(String(hit.title))}`, token);
  console.log(`C. upstream lyrics w/ RESOLVED id '${realId}':`, c.status, c.headers.get("content-type"));
  const cText = await c.text();
  summarize("C", cText);
  console.log("   sample:", cText.slice(0, 500).replace(/\n/g, " "));
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
