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
import ZAI from "z-ai-web-dev-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LINES = 160;
const MAX_LINE_CHARS = 600;

const SYSTEM_PROMPT =
  "You are a song lyric translator. You receive a JSON array of lyric lines. " +
  "Translate every line into the requested target language. Keep the SAME " +
  "number of items, same order, and same meaning — do not merge, split, " +
  "skip, or add lines. Keep interjections natural for a native speaker. " +
  'Respond with ONLY a raw JSON array of translated strings, e.g. ["...", "..."]. No markdown fences, no explanations.';

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

  let content: string | undefined;
  try {
    const zai = await ZAI.create();
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
    const message = error instanceof Error ? error.message : "translator unavailable";
    return Response.json({ error: `Translation failed — ${message}` }, { status: 502 });
  }

  const parsed = typeof content === "string" ? extractJsonArray(content) : null;
  if (!parsed) {
    return Response.json(
      { error: "Translator returned an unreadable response" },
      { status: 502 },
    );
  }

  // align 1:1 — any line the model skipped comes back unchanged
  const aligned = lines.map((line, index) => {
    const translated = parsed[index];
    return typeof translated === "string" && translated.trim()
      ? translated.trim()
      : line;
  });

  return Response.json({ lines: aligned }, { headers: { "cache-control": "no-store" } });
}
