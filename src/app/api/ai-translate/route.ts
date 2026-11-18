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

// One SDK client for the process. ZAI.create() pays connection/setup cost
// on every call; keeping the instance around turns repeat requests into a
// single model round-trip instead of setup + round-trip.
let zaiClient: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getZai() {
  if (!zaiClient) zaiClient = await ZAI.create();
  return zaiClient;
}

// Warm result cache. Lyric text is deterministic input — the same song in
// the same language always maps to the same answer, so a finished
// translation is served instantly on every later request (second device,
// cleared browser storage, a re-render of the same song). Insertion-order
// Map as a bounded LRU; keyed by a sha256 of lines+language so oversized
// lyric text never bloats the map.
const RESULT_CACHE_MAX = 200;
const resultCache = new Map<string, string[]>();

function resultCacheKey(lines: string[], targetLang: string): string {
  return createHash("sha256")
    .update(`${targetLang}\u0000${JSON.stringify(lines)}`)
    .digest("hex");
}

const SYSTEM_PROMPT =
  "You are a song lyric translator. You receive a JSON array of lyric lines. " +
  "Translate every line into the requested target language. Keep the SAME " +
  "number of items, same order, and same meaning — do not merge, split, " +
  "skip, or add lines. Keep interjections natural for a native speaker. " +
  'Respond with ONLY a raw JSON array of translated strings, e.g. ["...", "..."]. No markdown fences, no explanations.';

// --- MyMemory fallback -----------------------------------------------------
// Reachable from hosting datacenters where the platform LLM endpoint is not
// (api.mymemory.translated.net answers DC IPs without blocking). Per-line
// machine translation — lower quality than the LLM path, but it keeps the
// feature working everywhere. Runs in small concurrent chunks and is covered
// by the same result cache as the LLM path.

const SDK_COOLDOWN_MS = 10 * 60_000;
let sdkCooldownUntil = 0;

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
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed.slice(0, 500))}` +
    `&langpair=en|${target}&de=liner-web-relay@users.noreply.github.com`;
  const res = await fetch(url, { signal: AbortSignal.timeout(MM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
  };
  const translated = data.responseData?.translatedText;
  if (
    typeof translated !== "string" ||
    !translated.trim() ||
    translated.trim().toUpperCase() === trimmed.toUpperCase()
  ) {
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

  // Primary path: the platform LLM. Some hosting datacenters reset outbound
  // connections to its endpoint (running.sh does), so on failure we open a
  // cooldown and serve requests from the MyMemory fallback instead of paying
  // the failing round-trip on every call.
  let sdkError: string | null = null;
  let parsed: string[] | null = null;
  if (Date.now() >= sdkCooldownUntil) {
    let content: string | undefined;
    try {
      const zai = await getZai();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "assistant", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Target language: ${targetLang}.\nLines:\n${JSON.stringify(lines)}`,
          },
        ],
        thinking: { type: "disabled" },
      });
      content = completion.choices[0]?.message?.content;
    } catch (error) {
      sdkError = error instanceof Error ? error.message : "translator unavailable";
      sdkCooldownUntil = Date.now() + SDK_COOLDOWN_MS;
    }
    parsed = typeof content === "string" ? extractJsonArray(content) : null;
  } else {
    sdkError = "translator in cooldown";
  }

  if (!parsed) {
    parsed = await translateViaMyMemory(lines, targetLang);
    if (!parsed) {
      return Response.json(
        { error: sdkError ? `Translation failed — ${sdkError}` : "Translation failed — translators unavailable" },
        { status: 502 },
      );
    }
  }

  // align 1:1 — any line the model skipped comes back unchanged
  const aligned = lines.map((line, index) => {
    const translated = parsed[index];
    return typeof translated === "string" && translated.trim()
      ? translated.trim()
      : line;
  });

  resultCache.set(cacheKey, aligned);
  if (resultCache.size > RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) resultCache.delete(oldest);
  }

  return Response.json({ lines: aligned }, { headers: { "cache-control": "no-store" } });
}
