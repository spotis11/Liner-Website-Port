// Built-in lyrics translation endpoint — powers the "Liner AI" provider.
//
// The AI Translate feature needs a translator that works for everyone out of
// the box: no API key, no CORS juggling, and no datacenter-IP blocks (the
// free Google endpoint answers the server IP with 429 pages, which is exactly
// why the first version "wasn't translating"). This route runs the
// translation on our own server via the platform's LLM SDK.
//
// Input:  { lines: string[], targetLang: string }
// Output: { lines: string[] }  — aligned 1:1 with the input.

import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import ZAI from "z-ai-web-dev-sdk";
import { maintenanceGate } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LINES = 160;
const MAX_LINE_CHARS = 600;

// The whole song in ONE completion was the latency killer: a 60-line song
// made the model emit ~60 lines serially (10–20 s wall time). Chunks of
// ~24 lines complete in a few seconds each, and running several at once
// keeps the wall time near a single chunk's round-trip.
const LLM_CHUNK_SIZE = 24;
const LLM_CONCURRENCY = 4;

// One SDK client for the process. ZAI.create() pays connection/setup cost
// on every call; keeping the instance around turns repeat requests into a
// single model round-trip instead of setup + round-trip. Warm it at module
// load so the FIRST user request doesn't pay setup + round-trip either.
let zaiClient: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getZai() {
  if (!zaiClient) zaiClient = await ZAI.create();
  return zaiClient;
}
getZai().catch(() => {
  /* warmup is best-effort; the request path retries */
});

// Warm result cache. Lyric text is deterministic input — the same song in
// the same language always maps to the same answer, so a finished
// translation is served instantly on every later request (second device,
// cleared browser storage, a re-render of the same song). Insertion-order
// Map as a bounded LRU; keyed by a sha256 of lines+language so oversized
// lyric text never bloats the map.
const RESULT_CACHE_MAX = 200;
const resultCache = new Map<string, string[]>();

// Bumped when a change to the translation path could make previously
// cached entries wrong (e.g. the system-prompt-role / alignment fixes below).
// Rotating the namespace retires stale entries instead of trying to
// selectively invalidate them.
const CACHE_VERSION = "v4";

function resultCacheKey(lines: string[], targetLang: string): string {
  return createHash("sha256")
    .update(`${CACHE_VERSION}\u0000${targetLang}\u0000${JSON.stringify(lines)}`)
    .digest("hex");
}

// Prompt tuned per the singable-lyrics-translation research (EACL 2026 SRW
// "Towards Singable Lyrics Translation Using LLMs", MAVL/arXiv 2505.18614):
// line-by-line alignment is the hard constraint, and the winning quality
// lever is meaning-first phrasing — translate what the singer MEANS in
// natural, spoken target-language wording instead of word-for-word literal
// output, keep slang/interjections idiomatic, keep proper nouns and repeated
// hooks consistent across the whole song.
const SYSTEM_PROMPT =
  "You are Liner AI, an expert song lyric translator. You receive a JSON " +
  "array of lyric lines (detect the source language yourself). Translate " +
  "every line into the requested target language. HARD CONSTRAINTS: return " +
  "the SAME number of items, same order, one translated line per input " +
  "line — never merge, split, skip, or add lines, and never answer with " +
  "the original text unless the line is already in the target language. " +
  "QUALITY: translate the meaning, not word-for-word — a native speaker " +
  "should hear it as something a person would actually sing or say. Keep " +
  "slang, interjections and emotional tone idiomatic; keep proper nouns " +
  "(names, places, brands) as-is; use the same wording for a repeated " +
  "chorus line every time it repeats. Keep each line short enough to fit " +
  "the song's rhythm. " +
  'Respond with ONLY a raw JSON array of translated strings, e.g. ["...", "..."]. No markdown fences, no explanations.';

// --- MyMemory fallback -----------------------------------------------------
// Reachable from hosting datacenters where the platform LLM endpoint is not
// (api.mymemory.translated.net answers DC IPs without blocking). Per-line
// machine translation — lower quality than the LLM path, but it keeps the
// feature working everywhere. Runs in small concurrent chunks and is covered
// by the same result cache as the LLM path.

const SDK_COOLDOWN_MS = 10 * 60_000;
let sdkCooldownUntil = 0;

// Last-resort hop: when this container's egress to every translator is
// blocked (running.sh resets the LLM endpoint, MyMemory blocks the
// datacenter IP), forward the still-missing lines to a relay deployment
// whose network reaches both — the sandbox. Only engaged when
// AI_TRANSLATE_RELAY_URL is set (the relay deployment itself must NOT set
// it), and the hop header keeps a relayed request from relaying again.
const RELAY_TIMEOUT_MS = 75_000;

// Every other provider call in translate.ts wraps its fetch in
// AbortSignal.timeout(...); this mirrors that for the LLM SDK call, which
// had no timeout and could hang past the client's own 60s timeout. Chunks
// are small now, so 15 s is generous for one chunk's round-trip.
const LLM_TIMEOUT_MS = 15_000;

const MM_CONCURRENCY = 6;
const MM_TIMEOUT_MS = 12_000;

function normalizeMyMemoryLang(lang: string): string | null {
  const clean = lang.trim().toLowerCase().slice(0, 8);
  return /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(clean) ? clean : null;
}

function decodeMyMemoryEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function translateOneLine(
  line: string,
  target: string,
): Promise<string> {
  const trimmed = line.trim();
  if (!trimmed) return line;
  // Source language is Autodetect, NOT a hardcoded "en": lyric sheets arrive
  // in any language, and an "en|en" pair (English target, English source)
  // makes MyMemory answer with its error banner — which used to slip into
  // translatedText and reach users as the "translation" ("PLEASE SELECT TWO
  // DISTINCT LANGUAGES" showing up in the settings test). If Autodetect is
  // ever rejected, the line simply fails and falls to the next hop.
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed.slice(0, 500))}` +
    `&langpair=Autodetect|${target}&de=liner-web-relay@users.noreply.github.com`;
  const res = await fetch(url, { signal: AbortSignal.timeout(MM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = (await res.json()) as {
    responseStatus?: number | string;
    responseDetails?: string;
    responseData?: { translatedText?: string };
  };
  // MyMemory reports failures in responseStatus (403 same-language pair,
  // 429 quota) while STILL putting the error banner in translatedText —
  // so the status check is the real gate, and the banner regex is the
  // belt-and-braces backstop for statuses we have not seen yet.
  const status = Number(data.responseStatus);
  if (Number.isFinite(status) && status !== 200) {
    throw new Error(`mymemory ${status}`);
  }
  const translated = data.responseData?.translatedText;
  if (typeof translated !== "string" || !translated.trim()) {
    throw new Error("mymemory empty response");
  }
  if (/PLEASE SELECT TWO DISTINCT|MYMEMORY WARNING|QUOTA|INVALID/i.test(translated)) {
    throw new Error("mymemory error banner");
  }
  // a proper noun / short phrase legitimately comes back unchanged — that
  // is a real answer, not a failure
  if (translated.trim().toUpperCase() === trimmed.toUpperCase()) {
    return line;
  }
  return decodeMyMemoryEntities(translated.trim());
}

async function translateViaMyMemory(
  lines: string[],
  targetLang: string,
): Promise<string[] | null> {
  const target = normalizeMyMemoryLang(targetLang);
  if (!target) return null;
  const results: string[] = new Array(lines.length);
  try {
    for (let start = 0; start < lines.length; start += MM_CONCURRENCY) {
      const slice = lines.slice(start, start + MM_CONCURRENCY);
      const translated = await Promise.all(
        slice.map((line) => translateOneLine(line, target)),
      );
      translated.forEach((value, i) => {
        results[start + i] = value;
      });
    }
  } catch {
    return null;
  }
  return results;
}

/** Pull a raw JSON string array out of a model answer (fences tolerated). */
function extractJsonArray(raw: string): string[] | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed as string[];
    }
  } catch {
    // fall through
  }
  return null;
}

export async function POST(request: NextRequest) {
  const gate = await maintenanceGate();
  if (gate) return gate;
  let body: { lines?: unknown; targetLang?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const lines = body.lines;
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.length > MAX_LINES ||
    !lines.every((line) => typeof line === "string" && line.length <= MAX_LINE_CHARS)
  ) {
    return Response.json(
      { error: `Expected 1–${MAX_LINES} lyric lines of text` },
      { status: 400 },
    );
  }

  const targetLang =
    typeof body.targetLang === "string" && body.targetLang.trim()
      ? body.targetLang.trim().slice(0, 32)
      : "en";

  const cacheKey = resultCacheKey(lines, targetLang);
  const cached = resultCache.get(cacheKey);
  if (cached) {
    // LRU bump: re-insert so the entry counts as freshly used
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, cached);
    return Response.json(
      { lines: cached, cached: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Primary path: the platform LLM, run as parallel chunks. Some hosting
  // datacenters reset outbound connections to its endpoint (running.sh
  // does), so a failed chunk falls to MyMemory for just that slice; the
  // 10-minute cooldown opens only when EVERY content chunk failed at the
  // transport level (endpoint down) — not when one chunk timed out or came
  // back misaligned.
  const chunkIndexes: number[][] = [];
  for (let start = 0; start < lines.length; start += LLM_CHUNK_SIZE) {
    chunkIndexes.push(
      Array.from(
        { length: Math.min(LLM_CHUNK_SIZE, lines.length - start) },
        (_, offset) => start + offset,
      ),
    );
  }

  const translated: (string | null)[] = new Array(lines.length).fill(null);
  const chunkOk: boolean[] = new Array(chunkIndexes.length).fill(false);
  let firstSdkError: string | null = null;

  const translateChunk = async (indexes: number[]): Promise<boolean> => {
    const slice = indexes.map((i) => lines[i]);
    if (slice.every((line) => !line.trim())) return true; // nothing to do
    try {
      const zai = await getZai();
      const completion = await Promise.race([
        zai.chat.completions.create({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Target language: ${targetLang}.\nLines:\n${JSON.stringify(slice)}`,
            },
          ],
          temperature: 0.2,
          thinking: { type: "disabled" },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("zai timeout")), LLM_TIMEOUT_MS),
        ),
      ]);
      const content = completion.choices[0]?.message?.content;
      const parsed =
        typeof content === "string" ? extractJsonArray(content) : null;
      // Reject a misaligned response instead of silently letting every line
      // after a merge/drop shift by index — this chunk falls to MyMemory.
      if (!parsed || parsed.length !== slice.length) return false;
      indexes.forEach((lineIndex, i) => {
        const value = parsed[i];
        if (typeof value === "string" && value.trim()) {
          translated[lineIndex] = value.trim();
        }
      });
      return true;
    } catch (error) {
      if (!firstSdkError) {
        firstSdkError =
          error instanceof Error ? error.message : "translator unavailable";
      }
      return false;
    }
  };

  if (Date.now() < sdkCooldownUntil) {
    firstSdkError = "translator in cooldown";
  } else {
    // bounded concurrency: at most LLM_CONCURRENCY completions in flight
    const queue = chunkIndexes.map((_, k) => k);
    await Promise.all(
      Array.from(
        { length: Math.min(LLM_CONCURRENCY, queue.length) },
        async () => {
          for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
            chunkOk[k] = await translateChunk(chunkIndexes[k]);
          }
        },
      ),
    );
  }

  const contentChunks = chunkIndexes.filter((indexes) =>
    indexes.some((i) => lines[i].trim()),
  );
  const allContentChunksFailed =
    contentChunks.length > 0 &&
    contentChunks.every((indexes) =>
      chunkOk[chunkIndexes.indexOf(indexes)] === false,
    );
  if (allContentChunksFailed && Date.now() >= sdkCooldownUntil) {
    // the endpoint itself is unreachable — stop paying the failing
    // round-trip on every call until the cooldown lapses
    sdkCooldownUntil = Date.now() + SDK_COOLDOWN_MS;
  }

  // Relay hop for whatever the direct LLM path missed (see RELAY_TIMEOUT_MS
  // above) — it runs BEFORE MyMemory because it is the better translator:
  // full-context LLM lines instead of per-line machine translation, and it
  // does not have MyMemory's tiny daily free quota. MyMemory is now strictly
  // the last resort below; its quota exhaustion (or a same-language-pair
  // rejection) used to fill lines with error banners and starve this hop.
  const relayUrl = process.env.AI_TRANSLATE_RELAY_URL;
  const hopCount = Number(request.headers.get("x-liner-relay-hop") ?? "0");
  let relayError: string | null = null;
  let missing = translated
    .map((value, index) => (value === null ? index : -1))
    .filter((index) => index >= 0);
  if (relayUrl && missing.length > 0 && hopCount < 1) {
    try {
      const res = await fetch(relayUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-liner-relay-hop": String(hopCount + 1),
        },
        body: JSON.stringify({
          lines: missing.map((index) => lines[index]),
          targetLang,
        }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { lines?: unknown };
        if (Array.isArray(data.lines) && data.lines.length === missing.length) {
          const relayed = data.lines as unknown[];
          missing.forEach((lineIndex, i) => {
            const value = relayed[i];
            if (typeof value === "string" && value.trim()) {
              translated[lineIndex] = value.trim();
            }
          });
        } else {
          relayError = "relay returned a misaligned payload";
        }
      } else {
        relayError = `relay HTTP ${res.status}`;
      }
    } catch (error) {
      relayError =
        error instanceof Error ? error.message : "relay unreachable";
    }
    // refresh what the relay could not deliver
    missing = translated
      .map((value, index) => (value === null ? index : -1))
      .filter((index) => index >= 0);
  }

  // Last-resort MyMemory fallback for whatever is STILL missing — per-line
  // machine translation, lower quality than the LLM, subject to a daily
  // free quota, but it keeps the feature alive when every LLM hop failed.
  // translateOneLine throws on error banners (never returns one as text),
  // so a dead MyMemory leaves the slice untouched instead of poisoning it.
  if (missing.length > 0) {
    const slice = missing.map((index) => lines[index]);
    const viaMm = await translateViaMyMemory(slice, targetLang);
    if (viaMm) {
      missing.forEach((lineIndex, i) => {
        if (typeof viaMm[i] === "string" && viaMm[i].trim()) {
          translated[lineIndex] = viaMm[i].trim();
        }
      });
    }
  }

  const translatedAny = translated.some((value) => value !== null);
  if (!translatedAny) {
    return Response.json(
      {
        error: `Translation failed — ${
          relayError ??
          firstSdkError ??
          "translators unavailable"
        }`,
      },
      { status: 502 },
    );
  }

  // align 1:1 — any line no translator delivered comes back unchanged
  const aligned = lines.map((line, index) => {
    const value = translated[index];
    return typeof value === "string" && value.trim() ? value : line;
  });

  resultCache.set(cacheKey, aligned);
  if (resultCache.size > RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) resultCache.delete(oldest);
  }

  return Response.json({ lines: aligned }, { headers: { "cache-control": "no-store" } });
}
