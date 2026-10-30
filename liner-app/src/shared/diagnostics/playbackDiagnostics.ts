// Liner web port: playback diagnostics ring buffer.
//
// Track resolution can fail at several stages (Liner cache, YouTube TV,
// WEB_REMIX, playback profiles, SoundCloud stand-in) and the last error the
// user sees is usually a generic "track unavailable". To make failures
// diagnosable from the Settings UI (no devtools needed), every stage records
// what happened into a small persisted ring buffer that the Playback tab
// renders and can copy to the clipboard.

import { log } from "@/shared/utils/logger";

export type PlaybackStage =
  | "liner_cache"
  | "tv"
  | "webremix"
  | "profile"
  | "soundcloud"
  | "standin"
  | "soundcloud_standin"
  | "unresolved"
  | "played";

export interface PlaybackDiagnosticEntry {
  at: number;
  stage: PlaybackStage;
  detail: string;
  track: string | null;
}

const STORAGE_KEY = "liner_playback_diagnostics";
const MAX_ENTRIES = 10;

let entries: PlaybackDiagnosticEntry[] = [];
let loaded = false;
const listeners = new Set<(entries: PlaybackDiagnosticEntry[]) => void>();

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function load(): void {
  if (loaded || !isBrowser()) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    entries = parsed
      .filter((item): item is PlaybackDiagnosticEntry => {
        const e = item as PlaybackDiagnosticEntry;
        return (
          e &&
          typeof e.at === "number" &&
          typeof e.stage === "string" &&
          typeof e.detail === "string"
        );
      })
      .slice(0, MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function persist(): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage full / disabled — diagnostics stay in-memory only
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(entries);
    } catch {
      // listener errors must never break playback
    }
  }
}

export function recordPlaybackEvent(
  stage: PlaybackStage,
  detail: string,
  track: string | null,
): void {
  load();
  entries = [
    { at: Date.now(), stage, detail: detail.slice(0, 300), track },
    ...entries,
  ].slice(0, MAX_ENTRIES);
  persist();
  if (stage === "unresolved" || stage === "played")
    log(stage === "played" ? "cyan" : "yellow", "playback", `${stage}: ${detail}`);
  notify();
}

export function recordPlaybackFailure(
  stage: PlaybackStage,
  error: unknown,
  track: string | null,
): void {
  const message = error instanceof Error ? error.message : String(error);
  recordPlaybackEvent(stage, message, track);
}

export function recordPlaybackSuccess(
  source: Exclude<PlaybackStage, "unresolved">,
  detail: string,
  track: string | null,
): void {
  recordPlaybackEvent(source, detail, track);
}

export function getPlaybackDiagnostics(): PlaybackDiagnosticEntry[] {
  load();
  return entries;
}

export function clearPlaybackDiagnostics(): void {
  entries = [];
  persist();
  notify();
}

export function subscribePlaybackDiagnostics(
  listener: (entries: PlaybackDiagnosticEntry[]) => void,
): () => void {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPlaybackDiagnosticsForTests(): void {
  entries = [];
  loaded = false;
  listeners.clear();
}
