import { useState, useEffect } from "react";
import { useTranslation } from "@/languages";
import { usePlayerStore } from "@/features/player";
import { ToggleSwitch } from "@/shared/ui";
import { SettingRow, SettingSection, SegmentedControl } from "../controls";
import { PlaybackDiagnosticsPanel } from "./PlaybackDiagnosticsPanel";

export function PlaybackTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const autoplaySimilar = usePlayerStore((state) => state.autoplaySimilar);
  const setAutoplaySimilar = usePlayerStore(
    (state) => state.setAutoplaySimilar,
  );
  const trackDoubleClickBehavior = usePlayerStore(
    (state) => state.trackDoubleClickBehavior,
  );
  const setTrackDoubleClickBehavior = usePlayerStore(
    (state) => state.setTrackDoubleClickBehavior,
  );
  const defaultPlaybackContext = usePlayerStore(
    (state) => state.defaultPlaybackContext,
  );
  const setDefaultPlaybackContext = usePlayerStore(
    (state) => state.setDefaultPlaybackContext,
  );
  const pauseOnDeviceChange = usePlayerStore(
    (state) => state.pauseOnDeviceChange,
  );
  const setPauseOnDeviceChange = usePlayerStore(
    (state) => state.setPauseOnDeviceChange,
  );
  const hoverPreview = usePlayerStore((state) => state.hoverPreview);
  const setHoverPreview = usePlayerStore((state) => state.setHoverPreview);
  const soundcloudFallback = usePlayerStore(
    (state) => state.soundcloudFallback,
  );
  const setSoundcloudFallback = usePlayerStore(
    (state) => state.setSoundcloudFallback,
  );
  const miniPlayerEnabled = usePlayerStore(
    (state) => state.miniPlayerEnabled,
  );
  const setMiniPlayerEnabled = usePlayerStore(
    (state) => state.setMiniPlayerEnabled,
  );
  const soundWaveEnabled = usePlayerStore((state) => state.soundWaveEnabled);
  const setSoundWaveEnabled = usePlayerStore(
    (state) => state.setSoundWaveEnabled,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <SettingSection>

      <SettingRow
        title={t("settings.hover_preview.title")}
        description={t("settings.hover_preview.description")}
        titleKey="settings.hover_preview.title"
        descKey="settings.hover_preview.description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={hoverPreview}
            onChange={setHoverPreview}
          />
        }
      />

      <SettingRow
        title={t("settings.soundcloud_fallback.title")}
        description={t("settings.soundcloud_fallback.description")}
        titleKey="settings.soundcloud_fallback.title"
        descKey="settings.soundcloud_fallback.description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={soundcloudFallback}
            onChange={setSoundcloudFallback}
          />
        }
      />

      <SettingRow
        title={t("settings.cross_tab_miniplayer.title")}
        description={t("settings.cross_tab_miniplayer.description")}
        titleKey="settings.cross_tab_miniplayer.title"
        descKey="settings.cross_tab_miniplayer.description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={miniPlayerEnabled}
            onChange={setMiniPlayerEnabled}
          />
        }
      />

      <SettingRow
        title={t("settings.sound_wave.title")}
        description={t("settings.sound_wave.description")}
        titleKey="settings.sound_wave.title"
        descKey="settings.sound_wave.description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={soundWaveEnabled}
            onChange={setSoundWaveEnabled}
          />
        }
      />

      <SettingRow
        title={t("settings.autoplay_similar.title")}
        description={t("settings.autoplay_similar.description")}
        titleKey="settings.autoplay_similar.title"
        descKey="settings.autoplay_similar.description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={autoplaySimilar}
            onChange={setAutoplaySimilar}
          />
        }
      />

      <SettingRow
        title={t("settings.track_double_click.title")}
        description={t("settings.track_double_click.description")}
        titleKey="settings.track_double_click.title"
        descKey="settings.track_double_click.description"
        searchQuery={searchQuery}
        control={
          mounted ? (
            <SegmentedControl
              ariaLabel={t("settings.track_double_click.title")}
              value={trackDoubleClickBehavior}
              onChange={setTrackDoubleClickBehavior}
              options={[
                {
                  value: "play",
                  label: t("settings.track_double_click.play"),
                },
                {
                  value: "queue",
                  label: t("settings.track_double_click.queue"),
                },
              ]}
            />
          ) : (
            <span />
          )
        }
      />

      <SettingRow
        title={t("settings.default_playback_context.title")}
        description={t("settings.default_playback_context.description")}
        explained
        titleKey="settings.default_playback_context.title"
        descKey="settings.default_playback_context.description"
        searchQuery={searchQuery}
        control={
          mounted ? (
            <SegmentedControl
              ariaLabel={t("settings.default_playback_context.title")}
              value={defaultPlaybackContext}
              onChange={setDefaultPlaybackContext}
              options={[
                {
                  value: "resume",
                  label: t("settings.default_playback_context.resume"),
                },
                {
                  value: "empty",
                  label: t("settings.default_playback_context.empty"),
                },
              ]}
            />
          ) : (
            <span />
          )
        }
      />

      <SettingRow
        title={t("settings.audio.pause_on_device_change.title")}
        description={t("settings.audio.pause_on_device_change.description")}
        titleKey="settings.audio.pause_on_device_change.title"
        descKey="settings.audio.pause_on_device_change.description"
        searchQuery={searchQuery}
        control={
          <ToggleSwitch
            checked={pauseOnDeviceChange}
            onChange={setPauseOnDeviceChange}
          />
        }
      />

      <PlaybackDiagnosticsPanel searchQuery={searchQuery} />
    </SettingSection>
  );
}
