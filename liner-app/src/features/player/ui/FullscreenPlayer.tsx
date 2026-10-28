import { useCallback, useEffect, createElement, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shouldReleaseTopPin, startsPinnedToTop } from "./lyricsTopPin";
import { usePlayerState } from "../hooks/usePlayerState";
import { playerEngine } from "../engine/playerEngine";
import {
  useLyricsStore,
  LyricsProviderIsland,
  braccatoThemeCss,
} from "@/features/lyrics";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerUiElements } from "./PlayerUiElements";
import SoundWave, { useSoundWaveEnabled } from "./SoundWave";
import { DownLine } from "@mingcute/react";
import { preloadCoverArt, useCoverSrc } from "@/features/covers";
import "@braccato/core/element";
import "@braccato/core/styles/variables.css";
import "@braccato/core/styles/lyrics.css";
import "@braccato/core/styles/instrumental.css";
import KawarpWrapper from "./KawarpWrapper";
import { useTranslation } from "@/languages";

const BRACCATO_TAG = "braccato-lyrics";
const KAWARP_FADE_IN_MS = 600;
const LYRICS_VISIBLE_STORAGE_KEY = "liner.fullscreen.lyricsVisible";
/** smooth expo-ish curve shared by the lyrics show/hide choreography */
const LYRICS_TOGGLE_TRANSITION = {
  duration: 0.5,
  ease: [0.32, 0.72, 0, 1] as const,
};

/**
 * Persisted lyrics-panel visibility for the fullscreen player. The Liner
 * desktop app remembers whether you closed the lyrics pane; we do the same.
 */
function readStoredLyricsVisible(): boolean {
  try {
    return localStorage.getItem(LYRICS_VISIBLE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

interface BraccatoLyricsViewProps {
  lyrics: any[];
}

function BraccatoLyricsView({ lyrics }: BraccatoLyricsViewProps) {
  const player = usePlayerState();
  const elementRef = useRef<any>(null);
  const latestLyricsRef = useRef(lyrics);
  const freeScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWheelTimeRef = useRef(0);
  const isInFreeSearchRef = useRef(false);
  const waitingForAudioAfterClickRef = useRef(false);
  const pinnedToTopRef = useRef(startsPinnedToTop(player.status, player.positionMs));

  const scrollToActiveLine = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = elementRef.current;
      if (!el) return false;

      const activeEls = (el as HTMLElement).querySelectorAll<HTMLElement>(
        ".blyrics--active",
      );
      if (activeEls.length === 0) return false;
      const activeEl = activeEls[activeEls.length - 1];

      const containerRect = el.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      if (containerRect.height === 0 || elRect.height === 0) return false;

      const offset = elRect.top - containerRect.top + el.scrollTop;
      const targetScrollTop =
        offset - containerRect.height / 2 + elRect.height / 2;

      if (behavior === "auto") {
        el.scrollTop = Math.max(0, targetScrollTop);
      } else {
        el.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior,
        });
      }
      return true;
    },
    [],
  );

  const returnToFollowingMode = useCallback(() => {
    if (freeScrollTimerRef.current) {
      clearTimeout(freeScrollTimerRef.current);
      freeScrollTimerRef.current = null;
    }
    isInFreeSearchRef.current = false;
    lastWheelTimeRef.current = 0;

    const el = elementRef.current;
    if (!el) return;

    if (el.renderer) {
      el.renderer.resumeAutoscroll?.();
      const engine = (el.renderer as any)?.engine;
      if (engine) {
        engine.scrollResumeTime = 0;
        engine.nextScrollAllowedTime = 0;
        engine.queuedScroll = true;
      }
    }

    scrollToActiveLine("smooth");
  }, [scrollToActiveLine]);

  const returnToFollowingModeRef = useRef(returnToFollowingMode);
  returnToFollowingModeRef.current = returnToFollowingMode;

  const handleUserInteraction = useCallback(() => {
    pinnedToTopRef.current = false;
    lastWheelTimeRef.current = Date.now();
    isInFreeSearchRef.current = true;

    const el = elementRef.current;
    if (el?.renderer) {
      el.renderer.noteUserScroll?.();
      el.renderer.noteUserScroll?.();
      el.renderer.noteUserScroll?.();
    }

    if (freeScrollTimerRef.current) {
      clearTimeout(freeScrollTimerRef.current);
      freeScrollTimerRef.current = null;
    }

    freeScrollTimerRef.current = setTimeout(() => {
      const elapsed = Date.now() - lastWheelTimeRef.current;
      if (elapsed < 5900) return;

      returnToFollowingMode();
    }, 6000);
  }, [returnToFollowingMode]);

  const handleUserInteractionRef = useRef(handleUserInteraction);
  handleUserInteractionRef.current = handleUserInteraction;

  const setElement = useCallback(
    (el: any) => {
      elementRef.current = el;
      if (!el) return;
      el.theme = braccatoThemeCss;
      el.lyrics = latestLyricsRef.current;
      el.source = "#liner-audio";

      const handleBraccatoLineClick = (e: Event) => {
        const isAudioLoading = playerEngine.getSnapshot().status === "loading";
        if (isAudioLoading) {
          waitingForAudioAfterClickRef.current = true;
          isInFreeSearchRef.current = true;
          if (freeScrollTimerRef.current) {
            clearTimeout(freeScrollTimerRef.current);
            freeScrollTimerRef.current = null;
          }
          if (el.renderer) {
            el.renderer.noteUserScroll?.();
            el.renderer.noteUserScroll?.();
            el.renderer.noteUserScroll?.();
          }
        } else {
          returnToFollowingModeRef.current();
        }

        const detail = (e as CustomEvent).detail as
          { timeS?: number; time?: number } | undefined;
        const timeMs =
          detail?.timeS !== undefined
            ? Math.round(detail.timeS * 1000)
            : detail?.time !== undefined
              ? detail.time > 1000
                ? Math.round(detail.time)
                : Math.round(detail.time * 1000)
              : null;
        if (timeMs !== null) {
          playerEngine.seek(timeMs, true);
        }
      };

      const onUserScroll = () => {
        handleUserInteractionRef.current();
      };

      const onLyricsLoaded = () => {
        if (waitingForAudioAfterClickRef.current) return;
        requestAnimationFrame(() => {
          if (!waitingForAudioAfterClickRef.current) {
            scrollToActiveLine("auto");
          }
        });
      };

      let syncRafId: number;
      let lastReportedIndex = -1;

      const checkActiveLine = () => {
        const audioEl = document.getElementById(
          "liner-audio",
        ) as HTMLAudioElement | null;
        if (audioEl && !Number.isNaN(audioEl.currentTime)) {
          const currentMs = audioEl.currentTime * 1000;
          const lines = useLyricsStore.getState().syncedLines;
          let idx = -1;
          for (let i = 0; i < lines.length; i++) {
            const prevEnd =
              i > 0 && lines[i - 1].words && lines[i - 1].words!.length > 0
                ? lines[i - 1].words![lines[i - 1].words!.length - 1].endMs
                : i > 0
                  ? lines[i - 1].timeMs
                  : 0;
            const targetEarlyMs = Math.max(prevEnd, lines[i].timeMs - 600);
            if (targetEarlyMs <= currentMs) {
              idx = i;
            } else {
              break;
            }
          }
          if (idx !== lastReportedIndex) {
            lastReportedIndex = idx;
            useLyricsStore.getState().setActiveLineIndex(idx >= 0 ? idx : null);
          }
        }
        syncRafId = requestAnimationFrame(checkActiveLine);
      };

      syncRafId = requestAnimationFrame(checkActiveLine);

      el.addEventListener("braccato:lyrics-loaded", onLyricsLoaded);
      el.addEventListener("braccato:line-click", handleBraccatoLineClick);
      el.addEventListener("wheel", onUserScroll, {
        passive: true,
        capture: true,
      });
      el.addEventListener("touchmove", onUserScroll, {
        passive: true,
        capture: true,
      });

      return () => {
        cancelAnimationFrame(syncRafId);
        useLyricsStore.getState().setActiveLineIndex(null);
        el.removeEventListener("braccato:lyrics-loaded", onLyricsLoaded);
        el.removeEventListener("braccato:line-click", handleBraccatoLineClick);
        el.removeEventListener("wheel", onUserScroll, { capture: true });
        el.removeEventListener("touchmove", onUserScroll, { capture: true });
        if (freeScrollTimerRef.current) {
          clearTimeout(freeScrollTimerRef.current);
          freeScrollTimerRef.current = null;
        }
        elementRef.current = null;
      };
    },
    [scrollToActiveLine],
  );

  useEffect(() => {
    latestLyricsRef.current = lyrics;
    const element = elementRef.current;
    if (element) element.lyrics = lyrics;
  }, [lyrics]);

  useEffect(() => {
    if (
      (player.status === "playing" || player.status === "paused") &&
      waitingForAudioAfterClickRef.current
    ) {
      waitingForAudioAfterClickRef.current = false;
      returnToFollowingMode();
    }
  }, [player.status, returnToFollowingMode]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const checkAndScroll = () => {
      if (cancelled || waitingForAudioAfterClickRef.current || pinnedToTopRef.current) return;
      attempts++;
      const success = scrollToActiveLine("auto");
      if (!success && attempts < 30) {
        requestAnimationFrame(checkAndScroll);
      }
    };

    const rafId = requestAnimationFrame(checkAndScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [lyrics, scrollToActiveLine]);

  useEffect(() => {
    if (!pinnedToTopRef.current) return;
    const startedAt = performance.now();
    let rafId = 0;
    const holdTop = () => {
      const el = elementRef.current as HTMLElement & { renderer?: { noteUserScroll?: () => void; resumeAutoscroll?: () => void } };
      if (!pinnedToTopRef.current) return;
      const audio = document.getElementById("liner-audio") as HTMLAudioElement | null;
      const release = shouldReleaseTopPin({
        status: playerEngine.getSnapshot().status,
        audioPaused: !audio || audio.paused,
        audioTimeMs: (audio?.currentTime ?? 0) * 1000,
        pinnedForMs: performance.now() - startedAt,
      });
      if (release) {
        pinnedToTopRef.current = false;
        el?.renderer?.resumeAutoscroll?.();
        return;
      }
      if (el) {
        el.renderer?.noteUserScroll?.();
        if (el.scrollTop !== 0) el.scrollTop = 0;
      }
      rafId = requestAnimationFrame(holdTop);
    };
    rafId = requestAnimationFrame(holdTop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="relative flex flex-col flex-1 w-full h-full min-h-0">
      {createElement(BRACCATO_TAG, {
        ref: setElement,
        source: "#liner-audio",
        className: "block flex-1 w-full h-full px-6",
        style: {
          overflowY: "auto",
          overflowX: "hidden",
          position: "relative",
          scrollbarWidth: "none",
        },
      })}
    </div>
  );
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
  const coverUrl = player.currentTrack?.coverUrl;
  const kawarpSrc = useCoverSrc(coverUrl);

  useEffect(() => {
    if (!player.currentTrack) {
      onClose();
    }
  }, [player.currentTrack, onClose]);

  const {
    braccatoLyrics,
    lyricsLoading,
    lyricsError,
    plainLyrics,
    availableProviders,
    currentLyricsTrackId,
  } = useLyricsStore();

  const onError = useCallback((err: Error) => {
    console.error("kawarp load error:", err);
  }, []);

  const [kawarpShown, setKawarpShown] = useState(false);
  const onKawarpLoad = useCallback(() => {
    setTimeout(() => setKawarpShown(true), KAWARP_FADE_IN_MS);
  }, []);

  // lyrics pane toggle (top-left "Lyrics" pill, like the desktop app)
  const [lyricsVisible, setLyricsVisible] = useState(readStoredLyricsVisible);
  const toggleLyrics = useCallback(() => {
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

  const nextCoverUrl = player.queue[player.currentIndex + 1]?.coverUrl;
  useEffect(() => {
    void preloadCoverArt(coverUrl);
    void preloadCoverArt(nextCoverUrl);
  }, [coverUrl, nextCoverUrl]);

  const currentTrackId = player.currentTrack?.id;
  const isMatchingTrack = Boolean(
    currentTrackId && currentLyricsTrackId === currentTrackId,
  );
  const hasLyrics = isMatchingTrack && braccatoLyrics.length > 0;
  const showProviderIsland = hasLyrics && availableProviders.length > 0;
  const isInstrumental =
    isMatchingTrack &&
    !lyricsLoading &&
    !hasLyrics &&
    !lyricsError &&
    plainLyrics === "[INSTRUMENTAL]";

  // live sound wave — Web Audio analyser tap on the master output bus
  const soundWaveEnabled = useSoundWaveEnabled();

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
        {kawarpSrc && !kawarpShown && (
          <div
            className="absolute inset-0 bg-cover bg-center filter blur-3xl scale-110 opacity-70 pointer-events-none"
            style={{ backgroundImage: `url(${kawarpSrc})` }}
          />
        )}
        {effectsReady ? (
          <KawarpWrapper src={kawarpSrc} onLoad={onKawarpLoad} onError={onError} />
        ) : null}
      </div>

      <div className="absolute inset-0 z-[1] bg-black/40" />

      {/* sound wave visualizer — bottom strip behind the player UI, synced to
          the real audio graph (only when enabled in Settings > Playback) */}
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

      <div className="absolute inset-0 z-10 flex">
        {/* left: player UI — glides from half-width to centered when the
            lyrics pane is hidden */}
        <motion.div
          initial={false}
          animate={{ width: lyricsVisible ? "50%" : "100%" }}
          transition={LYRICS_TOGGLE_TRANSITION}
          className="flex flex-col items-center justify-center gap-5 overflow-hidden"
        >
          <PlayerUiElements onClose={onClose} />
        </motion.div>

        {/* right: lyrics pane — collapses to zero width (slide + fade) while
            the left column expands; fixed-width inner keeps text un-squished */}
        <motion.div
          initial={false}
          animate={{
            width: lyricsVisible ? "50%" : "0%",
            opacity: lyricsVisible ? 1 : 0,
            x: lyricsVisible ? 0 : 48,
          }}
          transition={LYRICS_TOGGLE_TRANSITION}
          className="h-full min-h-0 flex flex-col relative overflow-hidden"
        >
          <div className="w-[50vw] h-full min-h-0 pl-2 pr-6 flex flex-col relative shrink-0">
          {showProviderIsland && (
            <div className="absolute top-[6px] left-1/2 -translate-x-1/2 z-30 pointer-events-none flex justify-center">
              <LyricsProviderIsland />
            </div>
          )}

          <div
            className="flex-1 min-h-0 relative w-full h-full"
            style={{
              display: hasLyrics ? "flex" : "none",
            }}
          >
            <AnimatePresence initial={false}>
              {hasLyrics && (
                <motion.div
                  key={`lyrics-${currentTrackId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, pointerEvents: "none" }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="absolute inset-0 flex flex-col"
                >
                  <BraccatoLyricsView lyrics={braccatoLyrics} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait">
            {!hasLyrics && lyricsLoading ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex flex-col items-center justify-center"
              >
                <div className="flex flex-col gap-5 w-full max-w-[500px]">
                  {[80, 65, 45, 70, 55, 85, 60, 50, 75, 40, 65, 55].map(
                    (w, i) => (
                      <div
                        key={i}
                        className="h-5 rounded animate-pulse bg-border-alpha-14"
                        style={{ width: `${w}%` }}
                      />
                    ),
                  )}
                </div>
              </motion.div>
            ) : !hasLyrics && isInstrumental ? (
              <motion.div
                key="instrumental"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex items-center justify-center text-text-tertiary text-lg"
              >
                <span>{t("player.instrumental")}</span>
              </motion.div>
            ) : !hasLyrics ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex items-center justify-center text-text-tertiary"
              >
                <div className="flex flex-col items-center justify-center gap-3 opacity-80">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-40"
                  >
                    <path d="M9 18V5l12-2v13"></path>
                    <circle cx="6" cy="18" r="3"></circle>
                    <circle cx="18" cy="16" r="3"></circle>
                    <line x1="2" y1="2" x2="22" y2="22"></line>
                  </svg>
                  <span
                    className="text-[15px] font-[400] max-w-[250px] text-center"
                    style={{ lineHeight: "1.4" }}
                  >
                    {lyricsError || t("player.no_lyrics_found")}
                  </span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <button
        type="button"
        aria-label={t("player.close_fullscreen")}
        onClick={onClose}
        data-no-window-drag
        className="absolute top-[6px] left-[6px] z-30 inline-flex h-[32px] w-[32px] items-center justify-center rounded-lg border-none bg-black/50 backdrop-blur-xl text-white/80 hover:text-white hover:bg-white/10 active:scale-[0.94] transition-all cursor-pointer select-none pointer-events-auto"
      >
        <DownLine size={18} />
      </button>

      {/* lyrics pane toggle — like the desktop app's top-left "Lyrics" pill */}
      <button
        type="button"
        aria-pressed={lyricsVisible}
        aria-label={t("player.lyrics")}
        title={t("player.lyrics")}
        onClick={toggleLyrics}
        data-no-window-drag
        className={`absolute top-[6px] left-[46px] z-30 inline-flex h-[32px] items-center rounded-lg border-none px-[12px] backdrop-blur-xl active:scale-[0.94] transition-all duration-300 cursor-pointer select-none pointer-events-auto ${
          lyricsVisible
            ? "bg-white/15 text-white hover:bg-white/25"
            : "bg-black/50 text-white/70 hover:text-white hover:bg-white/10"
        }`}
      >
        <span className="text-[13px] font-[600] leading-none tracking-wide">
          {t("player.lyrics")}
        </span>
      </button>
    </div>
  );
}

export default function PlayerPage() {
  const navigate = useNavigate();
  return <FullscreenPlayer onClose={() => navigate(-1)} />;
}
