// Unit tests for the same-language no-op detector (lyricsLanguage.ts).
//
// The contract that matters:
//  - Lyrics already in the TARGET language ⇒ no-op (feature stands down):
//    English → English, Tagalog → Tagalog, Japanese → Japanese, …
//  - Lyrics in ANY other language ⇒ NOT a no-op (translate)
//  - Uncertain/short/mixed sheets are never flagged — a wrong detection
//    silently disables a song that needed translation, while a missed
//    detection only costs one wasted round-trip.

import { describe, it, expect } from "vitest";
import {
  detectLyricsAreEnglish,
  detectLyricsLanguage,
  isNoopTranslation,
  languageLabel,
} from "./lyricsLanguage";
import type { Lyric } from "@braccato/parsers";

function sheet(lines: string[]): Lyric[] {
  return lines.map((words, i) => ({
    words,
    startTimeMs: i * 5000,
    durationMs: 4000,
  })) as unknown as Lyric[];
}

const ENGLISH_SONG = [
  "I've been waiting for the sun to go down",
  "Thinking 'bout the nights we had together now",
  "And you know that I can't let you go",
  "You were the one that I was looking for",
  "So tell me why we always end up on the floor",
  "Is it too late to say I want you back again?",
  "We were running out of time from the start",
  "But I will never let you break my heart",
  "I don't know how to be alone with you",
  "Give me one more chance to make this right",
];

const TAGALOG_SONG = [
  "Teka muna, teka lang",
  "Pwede ba? Pwede ba?",
  "Sabihin mo na sa akin kung pano?",
  "Pano na kung iiwan mo ako?",
  "Pano na ang puso kong ito?",
  "Hindi na alam ang gagawin",
  "Kung wala ka na sa tabi ko",
  "Ang puso ko'y di mapakali",
  "Ika'y hinahanap ng mga mata",
  "Hanggang kailan ako maghihintay sa iyo",
];

const SPANISH_SONG = [
  "Yo no sé mañana si volverás",
  "La vida me enseñó a esperar",
  "Pero tú nunca llegas y me voy a olvidar",
  "Dime si este amor se puede salvar",
  "Quiero saber la verdad antes de brillar el sol",
];

const JAPANESE_SONG = [
  "この胸の高鳴りが止まらない",
  "君の声が聞こえる",
  "夜空を見上げて思うんだ",
];

const KOREAN_SONG = [
  "나의 마음을 그대에게 전하고 싶어",
  "그대는 나의 전부이니까",
  "우리의 이야기는 오늘도 계속될 거야",
];

const CHINESE_SONG = [
  "这是我心中最深的歌",
  "你是我的一切",
  "我们的故事永远不会结束",
];

const RUSSIAN_SONG = [
  "Я иду по улице, сердце бьётся в такт",
  "Ночь поёт мне о тебе снова и снова",
  "Мы с тобой останемся вдвоём до утра",
];

const UKRAINIAN_SONG = [
  "Я іду по вулиці, серце б'ється в такт",
  "Ніч співає мені про тебе знову",
  "Ми з тобою залишимся удвох до ранку",
];

describe("detectLyricsLanguage", () => {
  it("detects the Latin-script languages from function words", () => {
    expect(detectLyricsLanguage(sheet(ENGLISH_SONG))).toBe("en");
    expect(detectLyricsLanguage(sheet(TAGALOG_SONG))).toBe("tl");
    expect(detectLyricsLanguage(sheet(SPANISH_SONG))).toBe("es");
  });

  it("detects script languages outright", () => {
    expect(detectLyricsLanguage(sheet(JAPANESE_SONG))).toBe("ja");
    expect(detectLyricsLanguage(sheet(KOREAN_SONG))).toBe("ko");
    expect(detectLyricsLanguage(sheet(CHINESE_SONG))).toBe("zh");
    expect(detectLyricsLanguage(sheet(RUSSIAN_SONG))).toBe("ru");
    expect(detectLyricsLanguage(sheet(UKRAINIAN_SONG))).toBe("uk");
  });

  it("answers null for sheets it cannot trust (never disables on a guess)", () => {
    expect(detectLyricsLanguage(sheet(["Hello"]))).toBeNull();
    expect(detectLyricsLanguage([])).toBeNull();
    expect(detectLyricsLanguage(null)).toBeNull();
    // a mixed sheet whose top two candidates are close stays undecided
    const taglish = sheet([
      "I don't want to be the one you wait for now",
      "and I will never let you go, not again",
      "you were the one that I was looking for",
      "ang puso ko ay hindi na mapakali sa iyo",
      "kung kailan ako maghihintay hanggang sa dulo",
      "hindi na alam ang gagawin ko ng gabing ito",
    ]);
    expect(detectLyricsLanguage(taglish)).toBeNull();
  });

  it("caches per lyrics array identity", () => {
    const lyrics = sheet(ENGLISH_SONG);
    expect(detectLyricsLanguage(lyrics)).toBe("en");
    expect(detectLyricsLanguage(lyrics)).toBe("en"); // same array → cache hit
  });
});

describe("detectLyricsAreEnglish", () => {
  it("flags an English song as English", () => {
    expect(detectLyricsAreEnglish(sheet(ENGLISH_SONG))).toBe(true);
  });

  it("does not flag a Tagalog song as English (the Pano case)", () => {
    expect(detectLyricsAreEnglish(sheet(TAGALOG_SONG))).toBe(false);
  });

  it("does not flag a Spanish song as English", () => {
    expect(detectLyricsAreEnglish(sheet(SPANISH_SONG))).toBe(false);
  });

  it("never flags non-Latin script as English", () => {
    expect(detectLyricsAreEnglish(sheet(JAPANESE_SONG))).toBe(false);
  });

  it("answers false for tiny or empty sheets (uncertainty = keep working)", () => {
    expect(detectLyricsAreEnglish(sheet(["Hello"]))).toBe(false);
    expect(detectLyricsAreEnglish([])).toBe(false);
    expect(detectLyricsAreEnglish(null)).toBe(false);
  });
});

describe("isNoopTranslation", () => {
  it("stands down when the lyrics already ARE the target language", () => {
    const english = sheet(ENGLISH_SONG);
    const tagalog = sheet(TAGALOG_SONG);
    const japanese = sheet(JAPANESE_SONG);

    expect(isNoopTranslation(english, "en")).toBe(true);
    expect(isNoopTranslation(english, "EN")).toBe(true); // case-insensitive
    // the user's case: Tagalog lyrics picked for Tagalog must disable too
    expect(isNoopTranslation(tagalog, "tl")).toBe(true);
    expect(isNoopTranslation(tagalog, "fil")).toBe(true); // alternate code
    expect(isNoopTranslation(japanese, "ja")).toBe(true);
  });

  it("regional target codes match the base language (zh-CN / zh-TW)", () => {
    const chinese = sheet(CHINESE_SONG);
    expect(isNoopTranslation(chinese, "zh-CN")).toBe(true);
    expect(isNoopTranslation(chinese, "zh-TW")).toBe(true);
  });

  it("keeps the feature alive for any other target language", () => {
    const english = sheet(ENGLISH_SONG);
    const tagalog = sheet(TAGALOG_SONG);
    const japanese = sheet(JAPANESE_SONG);
    // the user's rule: another target language keeps the feature alive
    expect(isNoopTranslation(english, "tl")).toBe(false);
    expect(isNoopTranslation(english, "ja")).toBe(false);
    expect(isNoopTranslation(tagalog, "en")).toBe(false);
    expect(isNoopTranslation(tagalog, "ja")).toBe(false);
    expect(isNoopTranslation(japanese, "tl")).toBe(false);
  });

  it("never disables on an uncertain or tiny sheet", () => {
    expect(isNoopTranslation(sheet(["la la la"]), "en")).toBe(false);
    expect(isNoopTranslation([], "tl")).toBe(false);
    expect(isNoopTranslation(null, "ja")).toBe(false);
  });

  it("labels the detected language for the button hint", () => {
    expect(languageLabel("tl")).toBe("Filipino (Tagalog)");
    expect(languageLabel("en")).toBe("English");
    expect(languageLabel("ja")).toBe("Japanese");
  });
});
