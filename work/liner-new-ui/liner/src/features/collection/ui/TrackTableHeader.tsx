import { ClockLine } from "@mingcute/react";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";

/**
 * Column header row for the track table on collection pages. Mirrors the
 * geometry of SongCard rows (same padding, 48px number/cover slot, album and
 * date columns at SongCard's exported widths) so the labels line up.
 */
export default function TrackTableHeader({
  showAlbum = false,
  showDate = false,
  className,
}: {
  showAlbum?: boolean;
  showDate?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "sticky top-0 z-[5] flex items-center justify-between px-[8px] py-[6px] mx-[-8px] mb-[2px] border-b border-border-alpha-14 bg-bg-surface/95 backdrop-blur-sm select-none",
        className,
      )}
      data-no-window-drag
    >
      <div className="flex min-w-0 flex-1 items-center gap-[16px]">
        <span className="flex h-[48px] w-[48px] shrink-0 items-center justify-center text-label text-text-tertiary">
          #
        </span>
        <span className="min-w-0 text-caption font-[500] uppercase tracking-[0.06em] text-text-tertiary">
          {t("collection.track_col_title")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-[16px] ml-[16px]">
        {showAlbum && (
          <span className="hidden min-[900px]:block w-[200px] truncate text-caption font-[500] uppercase tracking-[0.06em] text-text-tertiary">
            {t("collection.album")}
          </span>
        )}
        {showDate && (
          <span className="hidden min-[900px]:block w-[110px] truncate text-caption font-[500] uppercase tracking-[0.06em] text-text-tertiary">
            {t("collection.date_added")}
          </span>
        )}
        <span className="flex w-[44px] items-center justify-end text-text-tertiary">
          <ClockLine size={15} />
        </span>
        <span className="w-[22px]" aria-hidden />
      </div>
    </div>
  );
}
