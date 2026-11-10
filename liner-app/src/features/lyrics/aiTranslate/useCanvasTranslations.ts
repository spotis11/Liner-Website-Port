// Bridges AI translations into the canvas lyrics renderer.
//
// The canvas lyrics view (upstream's CanvasLyricsView) draws lyrics as
// pixels, so the desktop-era DOM injection (braccato injectTranslation)
// cannot apply. The canvas engine natively renders a per-line subtitle
// under the main line when a Lyric carries `translation: { text, lang }`
// (see upstream canvas/buildLines.ts subtitleOf) — exactly how upstream
// renders native provider translations.
//
// This hook reuses the same translation cache the DOM hook fills: when the
// feature is enabled and a cached translation exists for the current
// track/provider/language, every line gets its translation merged in and
// the canvas draws it as the subtitle. Nothing here fetches — the root
// prefetcher (useAiTranslatePrefetch in App.tsx) starts the request the
// moment lyrics arrive.

import { useMemo } from "react";
import type { Lyric } from "@braccato/parsers";
import { useLyricsStore } from "../store/lyricsStore";
import {
  useAiTranslateStore,
  translationCacheKey,
} from "./aiTranslateStore";
import { isNoopTranslation } from "./lyricsLanguage";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function useCanvasTranslatedLyrics(): Lyric[] {
  const lyrics = useLyricsStore((s) => s.braccatoLyrics);
  const trackId = useLyricsStore((s) => s.currentLyricsTrackId);
  const enabled = useAiTranslateStore((s) => s.enabled);
  const provider = useAiTranslateStore((s) => s.provider);
  const targetLang = useAiTranslateStore((s) => s.targetLang);
  const cache = useAiTranslateStore((s) => s.cache);

  // Lyrics already in the target language are a no-op — the canvas must
  // not render "English → English" subtitles for that song.
  const noop = useMemo(
    () => isNoopTranslation(lyrics, targetLang),
    [lyrics, targetLang],
  );

  return useMemo(() => {
    if (!enabled || noop || !trackId || lyrics.length === 0) return lyrics;
    const cached = cache[translationCacheKey(trackId, provider, targetLang)];
    // the cached array is aligned against the lyric set that was live when
    // it was fetched — a provider switch with a different line count makes
    // the cache stale; drop it for this render instead of mis-aligning
    if (!cached || cached.lines.length !== lyrics.length) return lyrics;

    let merged = 0;
    const next = lyrics.map((line, index) => {
      const translated = cached.lines[index];
      if (typeof translated !== "string" || !translated.trim()) return line;
      const source = String(line.words ?? "");
      if (source.trim() && normalizeText(source) === normalizeText(translated)) {
        return line;
      }
      merged += 1;
      return { ...line, translation: { text: translated.trim(), lang: targetLang } };
    });
    return merged > 0 ? next : lyrics;
  }, [enabled, noop, trackId, provider, targetLang, cache, lyrics]);
}
