// Translation engine for the AI Translate feature.
//
// Transports:
//  - liner(): POSTs to the shell's dedicated /api/ai-translate route — a
//    built-in server-side translator (zero configuration, no API key) that
//    translates the whole song in one request.
//  - proxied(): goes through the shell's /api/fetch proxy (server-side fetch,
//    no CORS constraints, Authorization/custom headers forwarded) — used for
//    every hosted AI provider and as the Google Translate fallback.
//  - direct(): browser fetch. Google Translate allows cross-origin browser
//    GETs, so the gtx endpoint is called straight from the device first —
//    the user's own IP is rarely rate-limited, unlike the server's
//    datacenter IP (which Google answers with 429 pages). Also used for
//    Ollama which runs on the user's own machine.
//
// AI providers translate the whole song in ONE chat completion (lyrics are
// tiny) and must answer with a JSON array of translated lines; Google
// Translate translates line-by-line with bounded concurrency. Both paths
// return string[] aligned 1:1 with the input lines.

import type { AiProviderId } from "./providers";
import { getProviderDef } from "./providers";

export interface TranslateConfig {
  provider: AiProviderId;
  targetLang: string;
  apiKey?: string;
  model?: string;
  ollamaUrl?: string;
}

export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationError";
  }
}

const PROXY = "/api/fetch?u=";
const LINER_ROUTE = "/api/ai-translate";
const encoder = new TextEncoder();

function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

async function proxied(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(`${PROXY}${encodeURIComponent(url)}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Google Translate sends `access-control-allow-origin: *` on the gtx endpoint,
 * so the browser may call it directly. Direct uses the visitor's own IP
 * (residential — rarely blocked); the proxied server route is the fallback
 * for locked-down networks.
 */
async function gtxFetch(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return proxied(url, { method: "GET" });
  }
}

/** Lines that never make sense to translate (timestamps, blank, markers). */
export function isTranslatableLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^[\u266a\u266b\u266c\u266d\u266e\u266f\s♪♫]+$/.test(trimmed)) return false;
  if (/^\(?\s*instrumental\s*\)?$/i.test(trimmed)) return false;
  return true;
}

// ------------------------------------------------------------- Google -------

const GOOGLE_MAX_BYTES = 1400; // stay well under the ~2k URL budget
const GOOGLE_CONCURRENCY = 4;

function parseGoogleResponse(payload: unknown, sourceLine: string): string {
  // [ [ ["translated","original",null,null,x], ... ], null, "src-lang", ... ]
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw new TranslationError("Unexpected Google Translate response");
  }
  const segments = payload[0] as unknown[];
  const out: string[] = [];
  for (const seg of segments) {
    if (Array.isArray(seg) && typeof seg[0] === "string") {
      out.push(seg[0]);
    }
  }
  const joined = out.join("").trim();
  if (!joined) throw new TranslationError("Empty Google Translate response");
  // the gtx endpoint collapses blank lines; keep alignment by falling back
  return joined || sourceLine;
}

async function translateWithGoogleOne(
  text: string,
  targetLang: string,
  attempt = 0,
): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto` +
    `&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const res = await gtxFetch(url);
    if (!res.ok) {
      throw new TranslationError(`Google Translate HTTP ${res.status}`);
    }
    return parseGoogleResponse(await res.json(), text);
  } catch (error) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      return translateWithGoogleOne(text, targetLang, attempt + 1);
    }
    throw error;
  }
}

async function translateWithGoogle(
  lines: string[],
  targetLang: string,
): Promise<string[]> {
  const results: string[] = new Array(lines.length).fill("");
  const queue = lines
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => isTranslatableLine(text));

  if (queue.length === 0) return lines.map(() => "");

  // small songs translate in one burst; group tiny consecutive lines to
  // shrink request count while keeping each URL comfortably small
  const batches: { texts: string[]; indexes: number[] }[] = [];
  let currentTexts: string[] = [];
  let currentIndexes: number[] = [];
  let budget = 0;
  for (const item of queue) {
    const size = utf8Bytes(item.text) + 8;
    if (budget + size > GOOGLE_MAX_BYTES && currentTexts.length > 0) {
      batches.push({ texts: currentTexts, indexes: currentIndexes });
      currentTexts = [];
      currentIndexes = [];
      budget = 0;
    }
    currentTexts.push(item.text);
    currentIndexes.push(item.index);
    budget += size;
  }
  if (currentTexts.length > 0) {
    batches.push({ texts: currentTexts, indexes: currentIndexes });
  }

  let cursor = 0;
  let failedBatches = 0;
  const workers = Array.from(
    { length: Math.min(GOOGLE_CONCURRENCY, batches.length) },
    async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        // \n survives the gtx round-trip line-for-line for short lines
        const joined = batch.texts.join("\n");
        try {
          const url =
            `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto` +
            `&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(joined)}`;
          const res = await gtxFetch(url);
          if (!res.ok) throw new TranslationError(`Google Translate HTTP ${res.status}`);
          const payload = await res.json();
          const segments = Array.isArray(payload) && Array.isArray(payload[0])
            ? (payload[0] as unknown[])
            : null;
          const translated = segments
            ? segments
                .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
                .join("")
            : "";
          const parts = translated.split("\n").map((s) => s.trim());
          if (parts.length === batch.texts.length && parts.every(Boolean)) {
            batch.indexes.forEach((lineIndex, i) => {
              results[lineIndex] = parts[i];
            });
            continue;
          }
          throw new TranslationError("line count mismatch");
        } catch {
          // fall back to per-line translation for this batch
          let batchOk = 0;
          for (let i = 0; i < batch.texts.length; i++) {
            try {
              results[batch.indexes[i]] = await translateWithGoogleOne(
                batch.texts[i],
                targetLang,
              );
              batchOk += 1;
            } catch {
              results[batch.indexes[i]] = batch.texts[i];
            }
          }
          if (batchOk === 0) failedBatches += 1;
        }
      }
    },
  );
  await Promise.all(workers);

  // the gtx endpoint rate-limits datacenter IPs with an HTML "Sorry" page —
  // every batch then fails. Tell the caller instead of returning the song
  // untranslated, so the free chain can fail over to the backup service.
  if (failedBatches >= batches.length && batches.length > 0) {
    throw new TranslationError(
      "Google Translate is unreachable from this server (rate-limited).",
    );
  }
  return results;
}

// ---------------------------------------------------------- MyMemory -------

// free backup for the Google chain — no key, separate quota pool. MyMemory
// needs an explicit langpair; lyric autodetect is not supported, so only
// latin-script lines are offered (wrong-pair garbage is worse than nothing).

function isMostlyLatin(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  const latin = letters.replace(/[^\p{Script=Latin}]/gu, "");
  return latin.length / letters.length > 0.85;
}

async function translateWithMyMemory(
  lines: string[],
  targetLang: string,
): Promise<string[]> {
  const results: string[] = lines.map(() => "");
  const queue = lines
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => isTranslatableLine(text) && isMostlyLatin(text));
  if (queue.length === 0) return results;

  // MyMemory accepts one sentence per request reliably; keep it simple
  let cursor = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      try {
        const url =
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(item.text)}` +
          `&langpair=en|${encodeURIComponent(targetLang)}&de=liner@music.app`;
        const res = await proxied(url, { method: "GET" });
        if (!res.ok) throw new TranslationError(`MyMemory HTTP ${res.status}`);
        const payload = await res.json();
        const translated: string = payload?.responseData?.translatedText ?? "";
        if (
          translated &&
          !/MYMEMORY WARNING|QUOTA|INVALID/i.test(translated)
        ) {
          results[item.index] = translated;
        }
      } catch {
        /* leave empty — caller keeps the original line */
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ------------------------------------------------------------ Liner AI ------

// Built-in server-side translator — the shell exposes /api/ai-translate, a
// zero-configuration endpoint that translates the whole song in one request.
// This is the default provider because it works for everyone: no API key, no
// CORS, and no datacenter-IP rate limits (the model runs on our own server).

async function translateWithLiner({ config, lines }: ChatArgs): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(LINER_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines, targetLang: config.targetLang }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new TranslationError(
      "Liner AI is unreachable — check your connection and try again.",
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      const payload = await res.json();
      if (typeof payload?.error === "string") detail = payload.error;
    } catch {
      /* keep empty */
    }
    throw new TranslationError(
      `Liner AI HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  const payload = await res.json();
  const out = Array.isArray(payload?.lines) ? payload.lines : null;
  if (!out || !out.every((line: unknown) => typeof line === "string")) {
    throw new TranslationError("Unexpected Liner AI response");
  }
  return alignAiOutput(out as string[], lines);
}

// ------------------------------------------------------------ AI LLMs -------

const SYSTEM_PROMPT =
  "You are a song lyric translator. You receive a JSON array of lyric lines. " +
  "Translate every line into the requested target language. Keep the SAME " +
  "number of items, same order, and same meaning — do not merge, split, " +
  "skip, or add lines. Keep interjections natural for a native speaker. " +
  'Respond with ONLY a raw JSON array of translated strings, e.g. ["...", "..."]. No markdown fences, no explanations.';

interface ChatArgs {
  config: TranslateConfig;
  lines: string[];
}

function extractJsonArray(raw: string): string[] | null {
  let text = raw.trim();
  // tolerate markdown fences even though the prompt forbids them
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed as string[];
    }
  } catch {
    // try line-wise salvage below
  }
  return null;
}

/** Same length (or padded) string[] aligned with the source lines. */
function alignAiOutput(output: string[] | null, lines: string[]): string[] {
  if (!output) return lines;
  return lines.map((line, i) => {
    const translated = output[i];
    return typeof translated === "string" && translated.trim()
      ? translated.trim()
      : line;
  });
}

function buildUserPrompt(lines: string[], targetLang: string): string {
  const numbered = lines.map((line) => line.replace(/\n/g, " "));
  return `Target language: ${targetLang}.\nLines:\n${JSON.stringify(numbered)}`;
}

async function chatCompletion(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 45_000,
): Promise<string> {
  const res = await proxied(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (!res.ok) {
    let detail = "";
    try {
      const payload = await res.json();
      detail = payload?.error?.message ?? payload?.error ?? "";
      if (typeof detail !== "string") detail = JSON.stringify(payload).slice(0, 200);
    } catch {
      /* keep empty */
    }
    throw new TranslationError(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const payload = await res.json();
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

async function translateWithOpenRouter({ config, lines }: ChatArgs): Promise<string[]> {
  const model = config.model || getProviderDef("openrouter").defaultModel;
  const raw = await chatCompletion("https://openrouter.ai/api/v1/chat/completions", {
    authorization: `Bearer ${config.apiKey ?? ""}`,
  }, {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(lines, config.targetLang) },
    ],
    temperature: 0.2,
  });
  const payload = JSON.parse(raw);
  const content = payload?.choices?.[0]?.message?.content;
  return alignAiOutput(
    typeof content === "string" ? extractJsonArray(content) : null,
    lines,
  );
}

async function translateWithGemini({ config, lines }: ChatArgs): Promise<string[]> {
  const model = config.model || getProviderDef("gemini").defaultModel;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
    `:generateContent`;
  const raw = await chatCompletion(url, { "x-goog-api-key": config.apiKey ?? "" }, {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      { role: "user", parts: [{ text: buildUserPrompt(lines, config.targetLang) }] },
    ],
    generationConfig: { temperature: 0.2 },
  });
  const payload = JSON.parse(raw);
  const parts = payload?.candidates?.[0]?.content?.parts;
  const content = Array.isArray(parts)
    ? parts.map((p: { text?: string }) => p?.text ?? "").join("")
    : null;
  return alignAiOutput(
    typeof content === "string" ? extractJsonArray(content) : null,
    lines,
  );
}

async function translateWithOpenAi({ config, lines }: ChatArgs): Promise<string[]> {
  const model = config.model || getProviderDef("openai").defaultModel;
  const raw = await chatCompletion("https://api.openai.com/v1/chat/completions", {
    authorization: `Bearer ${config.apiKey ?? ""}`,
  }, {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(lines, config.targetLang) },
    ],
    temperature: 0.2,
  });
  const payload = JSON.parse(raw);
  const content = payload?.choices?.[0]?.message?.content;
  return alignAiOutput(
    typeof content === "string" ? extractJsonArray(content) : null,
    lines,
  );
}

async function translateWithClaude({ config, lines }: ChatArgs): Promise<string[]> {
  const model = config.model || getProviderDef("claude").defaultModel;
  const raw = await chatCompletion("https://api.anthropic.com/v1/messages", {
    "x-api-key": config.apiKey ?? "",
    "anthropic-version": "2023-06-01",
  }, {
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildUserPrompt(lines, config.targetLang) },
    ],
    temperature: 0.2,
  });
  const payload = JSON.parse(raw);
  const blocks = payload?.content;
  const content = Array.isArray(blocks)
    ? blocks.map((b: { text?: string }) => b?.text ?? "").join("")
    : null;
  return alignAiOutput(
    typeof content === "string" ? extractJsonArray(content) : null,
    lines,
  );
}

async function translateWithOllama({ config, lines }: ChatArgs): Promise<string[]> {
  const model = config.model || getProviderDef("ollama").defaultModel;
  const base = (config.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(lines, config.targetLang) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new TranslationError(
      "Ollama is unreachable — is it running? Start it with OLLAMA_ORIGINS=\"*\" so the browser may call it.",
    );
  }
  if (!res.ok) throw new TranslationError(`Ollama HTTP ${res.status}`);
  const payload = await res.json();
  const content = payload?.message?.content;
  return alignAiOutput(
    typeof content === "string" ? extractJsonArray(content) : null,
    lines,
  );
}

const AI_TRANSLATORS: Record<
  Exclude<AiProviderId, "google">,
  (args: ChatArgs) => Promise<string[]>
> = {
  liner: translateWithLiner,
  openrouter: translateWithOpenRouter,
  gemini: translateWithGemini,
  openai: translateWithOpenAi,
  claude: translateWithClaude,
  ollama: translateWithOllama,
};

// -------------------------------------------------------------- entry -------

export function providerIsReady(
  provider: AiProviderId,
  config: TranslateConfig,
): boolean {
  const def = getProviderDef(provider);
  if (def.needsKey && !(config.apiKey ?? "").trim()) return false;
  return true;
}

/**
 * Translate `lines` into config.targetLang. Returns string[] aligned 1:1 —
 * untranslatable lines (blank / ♪) come back unchanged.
 */
export async function translateLines(
  lines: string[],
  config: TranslateConfig,
): Promise<string[]> {
  if (lines.length === 0) return [];
  const targetLang = config.targetLang.trim() || "en";

  if (config.provider === "google") {
    try {
      return await translateWithGoogle(lines, targetLang);
    } catch (error) {
      // free-chain failover: MyMemory covers latin-script lines when Google
      // is rate-limited from the server IP
      const backup = await translateWithMyMemory(lines, targetLang);
      const covered = backup.some((line) => line.trim());
      if (!covered) throw error;
      return lines.map((line, i) => backup[i]?.trim() || line);
    }
  }

  const translator = AI_TRANSLATORS[config.provider];
  if (!translator) throw new TranslationError(`Unknown provider: ${config.provider}`);
  if (!providerIsReady(config.provider, config)) {
    throw new TranslationError(
      `${getProviderDef(config.provider).label} needs an API key — add it in Settings → AI Translate.`,
    );
  }
  const translatableIndexes: number[] = [];
  const translatable: string[] = [];
  lines.forEach((line, index) => {
    if (isTranslatableLine(line)) {
      translatableIndexes.push(index);
      translatable.push(line);
    }
  });
  if (translatable.length === 0) return lines;
  const translated = await translator({ config, lines: translatable });
  const results = [...lines];
  translatableIndexes.forEach((lineIndex, i) => {
    results[lineIndex] = translated[i] ?? lines[lineIndex];
  });
  return results;
}
