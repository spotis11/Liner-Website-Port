// Detects the language of a lyric sheet — well enough to answer ONE
// question: "would translating this song into the user's chosen target
// language change anything?"
//
// Tagalog lyrics + Tagalog target = nothing to translate, exactly like
// English + English. The feature must stand down for ANY song whose
// language already IS the target language — and must NOT stand down when
// the target is something else (an English song picked for Tagalog still
// translates, a Tagalog song picked for Japanese still translates).
//
// Why not the provider's metadata: the lyrics SSE contract carries no
// language field, and the /api/ai-translate route only learns the source
// language after it has already translated. So this is a client-side
// heuristic over the lyric text itself, in two tiers:
//
//   1. Script (definitive): Hangul is Korean, kana is Japanese, Thai
//      script is Thai, Devanagari is Hindi, Arabic script is Arabic,
//      Cyrillic is Russian or Ukrainian (its і/ї/є/ґ letters give Ukraine
//      away), Han without kana is Chinese. No target language shares these
//      scripts, so a couple of characters settle it.
//   2. Function-word competition (Latin script): every candidate language
//      gets a set of unambiguous grammar words (English "the/and/is",
//      Tagalog "ang/ng/sa/ko", Spanish "de/la/el/que"…). The language whose
//      markers clear a share threshold AND clearly outscores every other
//      candidate wins; anything less decisive answers "unknown", because a
//      wrong detection silently disables a song that needed translation
//      while a missed detection only costs one wasted round-trip.
//
// Ambiguity discipline: words shared across candidate languages ("que" in
// Spanish AND French, "mas" in Spanish AND Portuguese, "die" in German and
// English, "ama" in Turkish and Tagalog) are either assigned to both (they
// add to both scores, so the dominance rule still separates the languages)
// or dropped. Tokens are diacritic-stripped before lookup — lyrics are
// routinely written without accents — and single-letter tokens are trusted
// only where they are genuinely diagnostic ("i" English, "y" Spanish,
// "e" Italian, "o" Portuguese).
//
// The result is cached per lyrics array — the store replaces the array on
// every track/provider change, so identity is a sound cache key and the
// token scan runs once per song, not once per frame.

import type { Lyric } from "@braccato/parsers";

// Unambiguous English function words. Words that double as common words in
// Spanish/Portuguese/Tagalog ("me", "no", "la", "mi", "so"…) are
// deliberately NOT here — they would inflate the English score on those
// songs. English detection does not need them; the rest of the list is
// plenty.
const ENGLISH_WORDS = new Set([
  "the", "and", "you", "your", "yours", "i", "i'm", "i've", "i'll", "i'd",
  "my", "mine", "we", "us", "our", "ours", "he", "him", "his", "she", "her",
  "hers", "they", "them", "their", "theirs", "it", "it's", "its",
  "this", "that", "that's", "these", "those", "there", "here",
  "is", "are", "was", "were", "am", "be", "been", "being",
  "do", "does", "did", "done", "don't", "doesn't", "didn't",
  "have", "has", "had", "haven't", "hasn't", "hadn't",
  "will", "would", "can", "can't", "could", "should", "shall", "may",
  "might", "must", "won't", "wouldn't", "couldn't", "shouldn't",
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "into",
  "over", "under", "after", "before", "again", "about",
  "when", "while", "if", "because", "than", "then", "but", "or", "nor",
  "not", "what", "who", "how", "why", "where", "all", "just", "very",
  "too", "now", "out", "up", "down", "off", "only", "ever", "never",
  "always", "gonna", "wanna", "gotta", "let's", "you're", "you've",
  "you'll", "we're", "we've", "they're", "they've", "he's", "she's",
]);

// Every other Latin-script target language gets the same treatment: only
// grammar words that do not live in the other candidate sets (or that are
// shared on purpose, noted inline). Diacritics are already stripped — these
// sets are written in lookup form ("nao", not "não").
const LANGUAGE_MARKERS: Record<string, Set<string>> = {
  tl: new Set([
    // Tagalog / Filipino — "may" is kept despite English "may": Tagalog
    // songs lean on it hard, and English songs outscore it regardless.
    "ang", "ng", "sa", "na", "ko", "mo", "ako", "ikaw", "hindi", "pa", "lang",
    "mga", "ito", "iyan", "iyon", "yun", "yung", "ba", "din", "rin", "naman",
    "po", "opo", "nang", "kung", "kapag", "dahil", "kaya", "kahit", "hanggang",
    "wala", "may", "meron", "ka", "kita", "si", "ni", "ay", "pano", "paano",
    "bakit", "ganun", "ganyan", "dito", "doon", "noon", "bawat", "lahat",
    "atin", "aking", "iyo", "tayo", "sila", "kanila", "di", "talaga", "sobra",
    "ulit", "sana", "daw", "pala", "nga", "eh", "yata", "kayo", "namin",
    "ngayon", "kundi", "gaano", "gusto", "mahal", "puso", "sinta", "ibig",
    "sayang", "saya",
  ]),
  es: new Set([
    "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "es",
    "son", "por", "para", "con", "del", "al", "se", "su", "sus", "tu", "tus",
    "yo", "mas", "pero", "como", "estoy", "esta", "estas", "fui", "era",
    "quiero", "aqui", "ahi", "mi", "mis", "tuya", "tuyo", "este", "eso",
    "cuando", "porque", "nada", "nunca", "siempre", "tambien", "soy", "eres",
    "somos", "que",
    // "que" and "mas" are shared with French/Portuguese on purpose —
    // they add to both scores and the dominance rule breaks the tie.
  ]),
  pt: new Set([
    "nao", "uma", "das", "isso", "esse", "essa", "mais", "mas", "meu",
    "minha", "voce", "tudo", "mim", "aquele", "aquela", "agora", "tambem",
    "entao", "muito", "coisa", "saudade", "coracao", "este", "esta", "que",
    "o",
  ]),
  fr: new Set([
    "je", "tu", "il", "elle", "nous", "vous", "et", "est", "que", "pas",
    "moi", "toi", "pour", "avec", "dans", "sur", "mais", "oui", "mon", "ma",
    "mes", "ton", "tes", "notre", "votre", "leur", "etre", "avoir", "plus",
    "tout", "tous", "toujours", "jamais", "rien", "c'est", "j'ai", "ca",
  ]),
  de: new Set([
    "ich", "und", "nicht", "der", "die", "das", "ist", "mich", "dich", "mir",
    "dir", "du", "er", "sie", "wir", "ein", "eine", "einen", "dem", "den",
    "des", "mit", "fur", "auf", "aus", "bei", "nach", "wie", "wenn", "aber",
    "noch", "nur", "schon", "sehr", "immer", "nie", "auch", "bin", "bist",
    "haben",
  ]),
  it: new Set([
    "che", "sono", "non", "per", "anche", "io", "lui", "lei", "noi", "voi",
    "loro", "ho", "hai", "abbiamo", "questo", "questa", "quello", "quella",
    "piu", "ma", "con", "senza", "mio", "mia", "tuo", "tua", "suo", "sua",
    "cosa", "come", "dove", "quando", "perche", "solo", "ancora", "sempre",
    "mai", "qui", "ora", "siamo", "siete", "e",
  ]),
  pl: new Set([
    "sie", "ze", "nie", "jest", "jestem", "jestes", "bylo", "byla", "bylem",
    "tez", "czy", "mnie", "ciebie", "tobie", "siebie", "moze", "teraz",
    "bardzo", "juz", "ale", "tak",
  ]),
  tr: new Set([
    "bir", "ben", "sen", "icin", "ama", "cok", "daha", "gibi", "degil", "var",
    "yok", "benim", "senin", "bana", "sana", "seni", "beni", "boyle", "simdi",
    "zaman", "kalbim",
  ]),
  vi: new Set([
    "khong", "khong", "cua", "va", "minh", "chung", "toi", "ban", "anh",
    "em", "gi", "roi", "nha", "nhe", "nay", "nhung", "duoc", "da", "khi",
    "trong", "mot", "hai", "nguoi", "dang", "cung", "nhieu", "biet", "yeu",
  ]),
  id: new Set([
    "yang", "dan", "tidak", "sudah", "saja", "juga", "akan", "bisa", "aku",
    "kamu", "kita", "mereka", "ini", "itu", "dengan", "untuk", "pada",
    "karena", "kalau", "banget", "dong", "deh", "kah", "lah", "begitu", "gitu",
    "aja", "tapi", "udah", "gak", "nggak", "saya",
  ]),
};

// Single-letter tokens are only trusted where they are diagnostic. "i" is
// deliberately absent — it is already an English marker above, and listing
// it here would count every "i" twice.
const SINGLE_CHAR_MARKERS: Record<string, string[]> = {
  y: ["es"],
  e: ["it"],
  o: ["pt"],
};

const LATIN_LANGUAGE_CODES = ["en", ...Object.keys(LANGUAGE_MARKERS)] as const;

export function languageLabel(code: string): string {
  const labels: Record<string, string> = {
    en: "English",
    id: "Indonesian",
    tl: "Filipino (Tagalog)",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    pt: "Portuguese",
    it: "Italian",
    ru: "Russian",
    uk: "Ukrainian",
    tr: "Turkish",
    pl: "Polish",
    vi: "Vietnamese",
    th: "Thai",
    hi: "Hindi",
    ar: "Arabic",
  };
  return labels[code] ?? code.toUpperCase();
}

// Songs repeat a chorus; sampling a bounded token budget keeps the scan O(1)
// on long sheets without hurting the signal.
const MAX_TOKENS = 260;
const MIN_TOKENS = 8;
/** A candidate's marker words must be this share of tokens to win at all. */
const WIN_RATIO = 0.1;
/** …and must outscore every rival by this factor, or the sheet is "unknown". */
const DOMINANCE = 1.3;
/** Script decisions need a couple of characters, not one stray symbol. */
const MIN_SCRIPT_CHARS = 2;

interface ScanResult {
  tokens: number;
  latinChars: number;
  allChars: number;
  scripts: {
    kana: number;
    hangul: number;
    han: number;
    thai: number;
    devanagari: number;
    arabic: number;
    cyrillic: number;
    ukrainian: number;
    greek: number;
  };
  markerHits: Map<string, number>;
}

function stripDiacritics(token: string): string {
  return token.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function scan(lyrics: Lyric[]): ScanResult {
  const result: ScanResult = {
    tokens: 0,
    latinChars: 0,
    allChars: 0,
    scripts: {
      kana: 0, hangul: 0, han: 0, thai: 0, devanagari: 0, arabic: 0,
      cyrillic: 0, ukrainian: 0, greek: 0,
    },
    markerHits: new Map(),
  };
  const scripts = result.scripts;
  const hit = (language: string) =>
    result.markerHits.set(language, (result.markerHits.get(language) ?? 0) + 1);

  for (const line of lyrics) {
    if (result.tokens >= MAX_TOKENS) break;
    const text = typeof line?.words === "string" ? line.words : "";
    if (!text) continue;
    for (const raw of text.split(/\s+/)) {
      if (!raw) continue;
      const token = raw
        .toLowerCase()
        .replace(/[^\p{L}'’]/gu, "")
        .replace(/’/g, "'");
      if (!token) continue;
      result.tokens += 1;
      if (result.tokens > MAX_TOKENS) break;

      for (const ch of token) {
        result.allChars += 1;
        if (/\p{Script=Latin}/u.test(ch)) result.latinChars += 1;
        else if (/\p{Script=Hiragana}/u.test(ch) || /\p{Script=Katakana}/u.test(ch))
          scripts.kana += 1;
        else if (/\p{Script=Hangul}/u.test(ch)) scripts.hangul += 1;
        else if (/\p{Script=Han}/u.test(ch)) scripts.han += 1;
        else if (/\p{Script=Thai}/u.test(ch)) scripts.thai += 1;
        else if (/\p{Script=Devanagari}/u.test(ch)) scripts.devanagari += 1;
        else if (/\p{Script=Arabic}/u.test(ch)) scripts.arabic += 1;
        else if (/\p{Script=Cyrillic}/u.test(ch)) {
          scripts.cyrillic += 1;
          if (/[іїєґ]/u.test(ch)) scripts.ukrainian += 1;
        } else if (/\p{Script=Greek}/u.test(ch)) scripts.greek += 1;
      }

      // English keeps its original (unstripped) set — it is all ASCII.
      if (ENGLISH_WORDS.has(token)) hit("en");
      const lookup = token.length === 1
        ? undefined
        : stripDiacritics(token);
      if (lookup) {
        if (LANGUAGE_MARKERS.tl.has(lookup)) hit("tl");
        if (LANGUAGE_MARKERS.es.has(lookup)) hit("es");
        if (LANGUAGE_MARKERS.pt.has(lookup)) hit("pt");
        if (LANGUAGE_MARKERS.fr.has(lookup)) hit("fr");
        if (LANGUAGE_MARKERS.de.has(lookup)) hit("de");
        if (LANGUAGE_MARKERS.it.has(lookup)) hit("it");
        if (LANGUAGE_MARKERS.pl.has(lookup)) hit("pl");
        if (LANGUAGE_MARKERS.tr.has(lookup)) hit("tr");
        if (LANGUAGE_MARKERS.vi.has(lookup)) hit("vi");
        if (LANGUAGE_MARKERS.id.has(lookup)) hit("id");
      }
      const single = SINGLE_CHAR_MARKERS[token];
      if (single) for (const language of single) hit(language);
    }
  }
  return result;
}

const detectCache = new WeakMap<Lyric[], string | null>();

/**
 * The lyric sheet's language as one of the supported target codes
 * (en, tl, es, …), or null when the sheet is too short / mixed / undecided
 * to be trusted. Null NEVER disables anything — uncertainty must keep the
 * feature working, exactly the stance the English-only detector took.
 */
export function detectLyricsLanguage(
  lyrics: Lyric[] | null | undefined,
): string | null {
  if (!lyrics || lyrics.length === 0) return null;
  const cached = detectCache.get(lyrics);
  if (cached !== undefined) return cached;

  const detected = detectUncached(lyrics);
  detectCache.set(lyrics, detected);
  return detected;
}

function detectUncached(lyrics: Lyric[]): string | null {
  const s = scan(lyrics);
  const { scripts } = s;

  // Tier 1 — scripts decide outright, BEFORE any token-count gate: CJK/
  // Thai/Arabic lyric sheets carry no spaces, so three lines of Han text
  // scan as three "tokens" and would wrongly look "too short" here. Two
  // script characters are proof enough; MIN_SCRIPT_CHARS guards stray
  // symbols. Kana beats Han (Japanese uses both); Han without kana is
  // Chinese.
  if (scripts.kana >= MIN_SCRIPT_CHARS) return "ja";
  if (scripts.hangul >= MIN_SCRIPT_CHARS) return "ko";
  if (scripts.han >= MIN_SCRIPT_CHARS) return "zh";
  if (scripts.thai >= MIN_SCRIPT_CHARS) return "th";
  if (scripts.devanagari >= MIN_SCRIPT_CHARS) return "hi";
  if (scripts.arabic >= MIN_SCRIPT_CHARS) return "ar";
  if (scripts.cyrillic >= MIN_SCRIPT_CHARS) {
    return scripts.ukrainian >= MIN_SCRIPT_CHARS ? "uk" : "ru";
  }
  // Greek is not a target language — refuse to guess rather than let its
  // letters fall into the Latin word scoring.
  if (scripts.greek >= MIN_SCRIPT_CHARS) return null;

  // Tier 2 — Latin-script function-word competition. Only here does the
  // token budget matter: word ratios are meaningless on a handful of tokens.
  if (s.tokens < MIN_TOKENS) return null;
  if (s.latinChars / s.allChars < 0.9) return null;

  let winner: string | null = null;
  let winnerRatio = 0;
  let runnerUpRatio = 0;
  for (const language of LATIN_LANGUAGE_CODES) {
    const ratio = (s.markerHits.get(language) ?? 0) / s.tokens;
    if (ratio > winnerRatio) {
      runnerUpRatio = winnerRatio;
      winner = language;
      winnerRatio = ratio;
    } else if (ratio > runnerUpRatio) {
      runnerUpRatio = ratio;
    }
  }
  if (winnerRatio < WIN_RATIO) return null;
  // A sheet whose top two candidates are close (Taglish, Spanglish, franglais)
  // is genuinely mixed — leave it alone and let translation do its thing.
  if (winnerRatio < runnerUpRatio * DOMINANCE) return null;
  return winner;
}

/**
 * Kept for the changelog/tests: the English-specific view of the same
 * detector.
 */
export function detectLyricsAreEnglish(
  lyrics: Lyric[] | null | undefined,
): boolean {
  return detectLyricsLanguage(lyrics) === "en";
}

/** True when translating this sheet into `targetLang` would be a no-op. */
export function isNoopTranslation(
  lyrics: Lyric[] | null | undefined,
  targetLang: string,
): boolean {
  const base = targetLang.trim().toLowerCase().split("-")[0];
  if (!base) return false;
  const detected = detectLyricsLanguage(lyrics);
  if (!detected) return false;
  if (detected === base) return true;
  // Filipino ships as "tl" in the picker; "fil" is its alternate code.
  return detected === "tl" && (base === "tl" || base === "fil");
}
