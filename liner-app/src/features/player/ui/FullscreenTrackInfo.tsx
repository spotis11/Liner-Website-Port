import { useLocation } from "react-router-dom";
import { ArtistLink } from "@/features/artist";
import { ScrollableText } from "@/shared/ui";
import { usePlayerStore } from "../store/playerStore";

interface FullscreenTrackInfoProps {
  onClose?: () => void;
}

/**
 * evi-style centered track block: title over artist, both centered under the
 * cover art with no leading avatar. Like/add live in the utility row under
 * the transport (FullscreenTrackActions) so this column reads exactly like
 * the reference design — cover, title, artist, timeline, transport.
 */
export function FullscreenTrackInfo({ onClose }: FullscreenTrackInfoProps) {
  const location = useLocation();
  const track = usePlayerStore((s) => s.currentTrack);

  return (
    <div className="flex w-full flex-col items-center gap-[4px] text-center">
      <ScrollableText
        text={track?.title || ""}
        className="font-montserrat m-0 max-w-full text-center text-[20px] font-[600] leading-[1.2] tracking-[-0.01em] text-white"
      />
      <p className="font-montserrat m-0 flex min-w-0 max-w-full items-center justify-center gap-[6px] text-[14px] font-[500] text-white/70 leading-snug">
        {track?.explicit && (
          <span
            aria-label="Explicit"
            className="inline-flex h-[18px] w-[18px] shrink-0 -translate-y-px items-center justify-center rounded-[5px] bg-white/70 text-black/80"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M2.2 1H7.8V2.4H3.8V4.3H7.2V5.7H3.8V7.6H7.8V9H2.2Z"
                fill="currentColor"
              />
            </svg>
          </span>
        )}
        <ArtistLink
          name={track?.artists || ""}
          artistId={track?.artistId}
          artistList={track?.artistList}
          onNavigate={() => {
            if (location.pathname !== "/player") onClose?.();
          }}
          className="truncate text-white/70"
        />
      </p>
    </div>
  );
}
