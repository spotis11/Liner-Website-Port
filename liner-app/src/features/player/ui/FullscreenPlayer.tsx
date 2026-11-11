import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayerState } from "../hooks/usePlayerState";
import { useGlassBlur, useKawarpEnabled } from "../store/visualModeStore";
import { Notch } from "@/shared/ui";
import { FullscreenTopNotch } from "./FullscreenTopNotch";
import { LyricsNotchStatus } from "./LyricsNotchStatus";
import { FullscreenFrameGlass } from "./FullscreenFrameGlass";
import {
  useLyricsStore,
  LyricsProviderIsland,
  AiTranslateButton,
  useCanvasTranslatedLyrics,
} from "@/features/lyrics";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerUiElements } from "./PlayerUiElements";
import { DownLine, Music2Fill } from "@mingcute/react";
import { preloadCoverArt, useCoverSrc } from "@/features/covers";
import KawarpWrapper from "./KawarpWrapper";
import SoundWave, { useSoundWaveEnabled } from "./SoundWave";
import { useTranslation } from "@/languages";
import { useSettledLyricsLayout } from "../hooks/useSettledLyricsLayout";
import { CanvasLyricsView } from "./CanvasLyricsView";
import AmbientLayer from "./AmbientLayer";
import { BetaVisualsWarning } from "./BetaVisualsWarning";

const KAWARP_FADE_IN_MS = 600;

const LYRICS_VISIBLE_STORAGE_KEY = "liner.fullscreen.lyricsVisible";
/** smooth expo-ish curve shared by the lyrics show/hide choreography */
const LYRICS_TOGGLE_TRANSITION = {
  duration: 0.5,
  ease: [0.32, 0.72, 0, 1] as const,
};

/**
 * Persisted lyrics-pane visibility for the fullscreen player. The Liner
 * desktop app remembers whether you closed the lyrics pane; we do the same.
 */
function readStoredLyricsVisible(): boolean {
  try {
    return localStorage.getItem(LYRICS_VISIBLE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export interface FullscreenPlayerProps {
  effectsReady?: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({
  effectsReady = true,
  onClose,
}: FullscreenPlayerProps) {
  const { t } = useTranslation();
  const player = usePlayerState();
  const currentTrack = player.currentTrack;
  const nextCoverUrl = player.queue[player.currentIndex + 1]?.coverUrl;
  const coverUrl = currentTrack?.coverUrl;
  const kawarpSrc = useCoverSrc(coverUrl);

  useEffect(() => {
    if (!currentTrack) {
      onClose();
    }
  }, [currentTrack, onClose]);

  const {
    braccatoLyrics,
    lyricsLoading,
    lyricsError,
    plainLyrics,
    instrumental,
    availableProviders,
    currentLyricsTrackId,
  } = useLyricsStore();

  // AI translations merged into the line models — the canvas draws them as
  // per-line subtitles, the same way upstream renders native translations
  const lyrics = useCanvasTranslatedLyrics();

  const onError = useCallback((err: Error) => {
    console.error("kawarp load error:", err);
  }, []);

  const kawarpEnabled = useKawarpEnabled();
  const glassBlur = useGlassBlur();
  const [kawarpShown, setKawarpShown] = useState(false);
  const [kawarpWasEnabled, setKawarpWasEnabled] = useState(kawarpEnabled);
  if (kawarpWasEnabled !== kawarpEnabled) {
    setKawarpWasEnabled(kawarpEnabled);
    setKawarpShown(false);
  }
  const onKawarpLoad = useCallback(() => {
    setTimeout(() => setKawarpShown(true), KAWARP_FADE_IN_MS);
  }, []);

  useEffect(() => {
    void preloadCoverArt(coverUrl);
    void preloadCoverArt(nextCoverUrl);
  }, [coverUrl, nextCoverUrl]);

  const currentTrackId = currentTrack?.id;
  const isMatchingTrack = Boolean(
    currentTrackId && currentLyricsTrackId === currentTrackId,
  );
  const hasLyrics = isMatchingTrack && braccatoLyrics.length > 0;
  const showProviderIsland =
    isMatchingTrack && availableProviders.length > (hasLyrics ? 0 : 1);
  const isInstrumental =
    isMatchingTrack &&
    !lyricsLoading &&
    !hasLyrics &&
    !lyricsError &&
    (instrumental || plainLyrics === "[INSTRUMENTAL]");
  const isLyricsLoading = !hasLyrics && lyricsLoading;
  const isLyricsMissing = isMatchingTrack && !hasLyrics && !lyricsLoading;
  const isCompactLayout = useSettledLyricsLayout({
    isMatchingTrack,
    lyricsLoading,
    hasLyrics,
  });

  // live sound wave — Web Audio analyser tap on the master output bus
  // (only when enabled in Settings > Playback)
  const soundWaveEnabled = useSoundWaveEnabled();

  // lyrics pane toggle (fork, restored) — top-left notch "Lyrics" pill
  const [lyricsVisible, setLyricsVisible] = useState(readStoredLyricsVisible);
  // every press fires one expanding ring on the pill (see the pulse span below)
  const [lyricsPulse, setLyricsPulse] = useState(0);
  const toggleLyrics = useCallback(() => {
    setLyricsPulse((n) => n + 1);
    setLyricsVisible((v) => {
      const next = !v;
      try {
        localStorage.setItem(LYRICS_VISIBLE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable — the toggle still works for this session
      }
      return next;
    });
  }, []);

  const paneOpen = hasLyrics && lyricsVisible;

  return (
    <div
      data-theme="dark"
      className="dark relative h-full w-full overflow-hidden bg-black text-white"
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ backgroundColor: "var(--color-bg-primary)" }}
        />
        {(kawarpSrc || coverUrl) && (!kawarpShown || !kawarpEnabled) && (
          <img
            src={kawarpSrc || coverUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            style={{
              filter: "blur(64px) saturate(1.3)",
              transform: "scale(1.3)",
            }}
          />
        )}
        {effectsReady && kawarpEnabled ? (
          <KawarpWrapper
            src={kawarpSrc}
            onLoad={onKawarpLoad}
            onError={onError}
          />
        ) : null}
        <AmbientLayer trackId={currentTrackId} />
      </div>

      <div className="absolute inset-0 z-[1] bg-black/40" />

      {/* live sound wave visualizer — bottom strip behind the player UI,
          synced to the real audio graph (fork: Settings > Playback toggle) */}
      {soundWaveEnabled ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[38vh]"
          style={{
            maskImage:
              "linear-gradient(to top, black 40%, rgba(0,0,0,0.6) 70%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to top, black 40%, rgba(0,0,0,0.6) 70%, transparent)",
          }}
        >
          <SoundWave className="h-full w-full" />
        </div>
      ) : null}

      <FullscreenFrameGlass />

      <div className="absolute inset-1.5 z-10 flex">
        {/* left: player UI — glides from half-width to centered while the
            lyrics pane collapses (fork lyrics toggle choreography) */}
        <motion.div
          initial={false}
          animate={{ width: paneOpen ? "50%" : "100%" }}
          transition={LYRICS_TOGGLE_TRANSITION}
          className="flex flex-1 flex-col items-center justify-center gap-5 overflow-hidden"
        >
          <PlayerUiElements
            onClose={onClose}
            layout={isCompactLayout ? "horizontal" : "vertical"}
          />
        </motion.div>

        {/* right: lyrics pane — collapses to zero width (slide + fade) while
            the left column expands; fixed-width inner keeps the canvas
            un-squished during the tween */}
        <motion.div
          initial={false}
          animate={{
            width: paneOpen ? "50%" : "0%",
            opacity: paneOpen ? 1 : 0,
            x: paneOpen ? 0 : 48,
          }}
          transition={LYRICS_TOGGLE_TRANSITION}
          className="h-full min-h-0 flex flex-col relative overflow-hidden"
        >
          <div className="w-[50vw] h-full min-h-0 pl-2 pr-6 flex flex-col relative shrink-0">
            <div
              className="flex-1 min-h-0 relative w-full h-full"
              style={{
                display: hasLyrics ? "flex" : "none",
              }}
            >
              <AnimatePresence initial={false}>
                {paneOpen && (
                  <motion.div
                    key={`lyrics-${currentTrackId}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, pointerEvents: "none" }}
                    transition={{ duration: 0.22, ease: "easeInOut" }}
                    className="absolute inset-0 flex flex-col"
                  >
                    <CanvasLyricsView lyrics={lyrics} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="absolute top-1.5 left-1/2 z-30 flex -translate-x-1/2 justify-center pointer-events-none">
        <FullscreenTopNotch>
          <BetaVisualsWarning docked={false} />
          {lyricsVisible && showProviderIsland && <LyricsProviderIsland />}
          {lyricsVisible && isLyricsLoading && (
            <LyricsNotchStatus kind="loading" />
          )}
          {lyricsVisible && isLyricsMissing && (
            <LyricsNotchStatus
              kind={isInstrumental ? "instrumental" : "missing"}
            />
          )}
        </FullscreenTopNotch>
      </div>

      <div className="absolute top-1.5 left-1.5 z-30">
        <Notch align="start" tone="glass" blur={glassBlur}>
          <button
            type="button"
            aria-label={t("player.close_fullscreen")}
            onClick={onClose}
            data-no-window-drag
            className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-control border-none bg-transparent text-white/70 transition-colors select-none hover:bg-white/10 hover:text-white active:scale-95"
          >
            <DownLine size={16} />
          </button>

          {/* lyrics pane toggle (fork, restored) — press springs the pill,
              fires one expanding ring, and the music glyph slides in while
              the pane choreographs across (LYRICS_TOGGLE_TRANSITION) */}
          <button
            type="button"
            aria-pressed={lyricsVisible}
            aria-label={t("player.lyrics")}
            title={t("player.lyrics")}
            onClick={toggleLyrics}
            data-no-window-drag
            className={`relative inline-flex h-[26px] cursor-pointer select-none items-center overflow-hidden rounded-control border-none px-[9px] transition-colors duration-200 ease-out active:scale-[0.9] ${
              lyricsVisible
                ? "bg-white/15 text-white hover:bg-white/25"
                : "bg-transparent text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            {lyricsPulse > 0 && (
              <motion.span
                key={lyricsPulse}
                initial={{ opacity: 0.5, scale: 0.55 }}
                animate={{ opacity: 0, scale: 2.1 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none absolute inset-0 rounded-control bg-white"
                aria-hidden
              />
            )}
            <motion.span
              className="relative inline-flex items-center gap-[4px] text-[12px] font-[600] leading-none tracking-wide"
              animate={{ scale: lyricsVisible ? 1 : 0.97 }}
              transition={{ type: "spring", stiffness: 350, damping: 22 }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {lyricsVisible && (
                  <motion.span
                    key="lyrics-pill-icon"
                    initial={{ opacity: 0, width: 0, scale: 0.4 }}
                    animate={{ opacity: 1, width: 14, scale: 1 }}
                    exit={{ opacity: 0, width: 0, scale: 0.4 }}
                    transition={{
                      duration: 0.28,
                      ease: [0.32, 0.72, 0, 1],
                    }}
                    className="inline-flex items-center justify-center overflow-hidden"
                    aria-hidden
                  >
                    <Music2Fill size={12} />
                  </motion.span>
                )}
              </AnimatePresence>
              <span className="relative">{t("player.lyrics")}</span>
            </motion.span>
          </button>
        </Notch>
      </div>

      {/* AI translate toggle (fork feature) — top-right glass notch, the
          mirror of upstream's close notch */}
      <div className="absolute top-1.5 right-1.5 z-30">
        <Notch align="end" tone="glass" blur={glassBlur}>
          <AiTranslateButton />
        </Notch>
      </div>
    </div>
  );
}

export default function PlayerPage() {
  const navigate = useNavigate();
  return <FullscreenPlayer onClose={() => navigate(-1)} />;
}
