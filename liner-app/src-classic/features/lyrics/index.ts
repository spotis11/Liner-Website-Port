export { braccatoThemeCss } from "./engine/braccatoTheme";
export {
  parseRawLyrics,
  applyLyricsOffset,
  type ParsedLyrics,
  type WordData,
} from "./engine/lyricsParser";
export {
  useLyricsStore,
  hasSyncedLyricsSources,
  type LyricsProviderOption,
} from "./store/lyricsStore";
export {
  lyricsCache,
  isLyricsCandidate,
  shouldCacheLyricsCandidate,
  isProvisionalLyricsCandidate,
  mergeLyricsProvider,
  compareLyricsCandidates,
  isBetterLyricsCandidate,
  isWordLevelSync,
  type CachedLyricsItem,
} from "./store/lyricsCache";
export {
  useLyricsAnimator,
  type LyricsWord,
  type SyncedLine,
} from "./hooks/useLyricsAnimator";
export { LyricsProviderIsland } from "./ui/LyricsProviderIsland";
// AI lyrics translation (Settings → AI Translate + fullscreen player toggle)
export {
  AI_PROVIDERS,
  getProviderDef,
  useAiTranslateStore,
  translationCacheKey,
  resolveModel,
  translateLines,
  TranslationError,
  providerIsReady,
  useLyricsAiTranslation,
  useCanvasTranslatedLyrics,
  ensureTranslation,
  useAiTranslatePrefetch,
  AiTranslateButton,
  AiTranslateSettingsTab,
  type AiProviderId,
  type TranslationStatus,
} from "./aiTranslate";
export {
  LyricsCanvasRenderer,
  type LyricsClock,
  type EdgesListener,
} from "./canvas/lyricsCanvasRenderer";
// Lyric style themes (Settings → Lyrics)
export {
  LYRIC_STYLES,
  LYRIC_STYLE_CATEGORIES,
  DEFAULT_LYRIC_STYLE_ID,
  getLyricStyle,
  resolveLyricsTypography,
  type LyricStyleCategory,
  type LyricStyleTheme,
  type LyricStylePrefs,
} from "./styles/lyricStyles";
export {
  useLyricsStyleStore,
  useLyricsStyleTypography,
} from "./store/lyricsStyleStore";
