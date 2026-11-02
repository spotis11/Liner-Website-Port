import { useSyncExternalStore, useCallback } from "react";
import { useTranslation } from "@/languages";
import { Button } from "@/shared/ui";
import {
  getPlaybackDiagnostics,
  clearPlaybackDiagnostics,
  subscribePlaybackDiagnostics,
  type PlaybackDiagnosticEntry,
} from "@/shared/diagnostics/playbackDiagnostics";

function subscribe(callback: () => void) {
  return subscribePlaybackDiagnostics(callback);
}

function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function entryText(entry: PlaybackDiagnosticEntry): string {
  const time = new Date(entry.at).toLocaleTimeString();
  return entry.track
    ? `${time} [${entry.stage}] ${entry.track} — ${entry.detail}`
    : `${time} [${entry.stage}] ${entry.detail}`;
}

export function PlaybackDiagnosticsPanel({
  searchQuery,
}: {
  searchQuery?: string;
}) {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(subscribe, getPlaybackDiagnostics);

  const copy = useCallback(() => {
    const text = entries
      .slice()
      .reverse()
      .map(entryText)
      .join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, [entries]);

  const title = t("settings.playback_diagnostics.title");
  const description = t("settings.playback_diagnostics.description");

  // respect the settings search: same behaviour as SettingRow/SettingBlock
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    const haystack = `${title} ${description}`.toLowerCase();
    if (!haystack.includes(q)) return null;
  }

  return (
    <div
      data-testid="playback-diagnostics"
      className="flex flex-col gap-[10px] rounded-[14px] border border-text-primary/10 bg-text-primary/[0.03] px-[14px] py-[13px]"
    >
      <div className="flex min-w-0 max-w-[460px] flex-col gap-[2px]">
        <span className="text-text-primary text-[14px] font-[500] leading-snug">
          {title}
        </span>
        <span className="text-text-tertiary text-[12px] leading-[1.45]">
          {description}
        </span>
      </div>

      {entries.length === 0 ? (
        <span className="text-text-tertiary text-[12px]">
          {t("settings.playback_diagnostics.empty")}
        </span>
      ) : (
        <ul className="m-0 flex max-h-[150px] list-none flex-col gap-[4px] overflow-y-auto p-0">
          {entries.map((entry, index) => (
            <li
              key={`${entry.at}-${index}`}
              className="text-text-secondary break-all font-mono text-[11px] leading-[1.5]"
            >
              {entryText(entry)}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-[8px]">
        <Button
          variant="outline"
          size="sm"
          onClick={copy}
          disabled={entries.length === 0}
        >
          {t("settings.playback_diagnostics.copy")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearPlaybackDiagnostics}
          disabled={entries.length === 0}
        >
          {t("settings.playback_diagnostics.clear")}
        </Button>
      </div>
    </div>
  );
}
