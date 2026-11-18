import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayFill, AddLine } from "@mingcute/react";
import { LuShuffle, LuTrash2 } from "react-icons/lu";
import { playerEngine } from "@/features/player";
import { useClassicSurfaces } from "@/features/settings/store/customizationStore";
import { useTranslation } from "@/languages";
import { cn, usePageBackdrop } from "@/shared/lib";
import localFilesCover from "@/assets/local-files-cover.svg";
import { formatTotalDuration } from "@/shared/utils/formatTrackDurations";
import {
  EntityHero,
  HERO_BUTTON_CLASS,
  HERO_CHIP_CLASS,
  HERO_GLASS_BUTTON_CLASS,
  HERO_GLASS_CLASS,
  HERO_TITLE_CLASS,
  HeroSubtitle,
} from "@/shared/ui";
import Button from "@/shared/ui/Button";
import {
  TrackSearchEmpty,
  TrackSearchField,
  useTrackSearch,
} from "../../ui/TrackSearch";
import { TrackSortMenu, useTrackSort } from "../../ui/TrackSort";
import { useLocalImport } from "../hooks/useLocalImport";
import { useLocalTracks } from "../hooks/useLocalTracks";
import LocalFilesCover from "./LocalFilesCover";
import LocalTrackList from "./LocalTrackList";
import LocalTracksEmpty from "./LocalTracksEmpty";
import RemoveAllLocalDialog from "./RemoveAllLocalDialog";

const PAGE_KEY = "local";

export default function LocalTracksPage() {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const classicSurfaces = useClassicSurfaces();
  const { tracks, isLoading } = useLocalTracks();
  const { chooseFiles, importing } = useLocalImport();
  const [removeAllOpen, setRemoveAllOpen] = useState(false);
  usePageBackdrop(localFilesCover);

  const sort = useTrackSort(tracks, PAGE_KEY);
  const search = useTrackSearch(sort.sorted, PAGE_KEY);
  const entries = useMemo(
    () =>
      search.matches ?? sort.sorted.map((track, index) => ({ track, index })),
    [search.matches, sort.sorted],
  );
  const context = t("library.local.title");
  const empty = tracks.length === 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [search.activeQuery, sort.option]);

  const playAll = useCallback(() => {
    if (!sort.sorted.length) return;
    playerEngine.clearQueue();
    void playerEngine.playTrack(sort.sorted[0], sort.sorted, context);
  }, [sort.sorted, context]);

  const shuffle = useCallback(() => {
    if (!sort.sorted.length) return;
    playerEngine.clearQueue();
    void playerEngine.playShuffled(sort.sorted, context);
  }, [sort.sorted, context]);

  const submitSearch = useCallback(() => {
    const first = search.matches?.[0];
    if (first) void playerEngine.playTrack(first.track, sort.sorted, context);
  }, [search.matches, sort.sorted, context]);

  const totalMs = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0),
    [tracks],
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      <div
        ref={scrollRef}
        data-no-window-drag
        className="relative z-10 box-border flex h-full w-full min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain pt-(--page-inset-top) pb-(--page-inset-bottom)"
      >
        <div className="shrink-0 pl-[16px] pr-[12px] pt-[8px]">
          <EntityHero
            cover={<LocalFilesCover className="absolute inset-0" />}
            title={<h1 className={HERO_TITLE_CLASS}>{context}</h1>}
            subtitle={<HeroSubtitle text={t("library.local.subtitle")} />}
            meta={
              <div className={HERO_CHIP_CLASS}>
                <span>{t("common.songs", { count: tracks.length })}</span>
                {!empty && (
                  <>
                    <span
                      className="h-[3px] w-[3px] shrink-0 rounded-full bg-text-secondary/50"
                      aria-hidden
                    />
                    <span>{formatTotalDuration(totalMs, t)}</span>
                  </>
                )}
              </div>
            }
            actions={
              <>
                <Button
                  variant="primary"
                  onClick={playAll}
                  disabled={empty}
                  className={`${HERO_BUTTON_CLASS} px-[22px]`}
                >
                  <PlayFill size={16} />
                  <span>{t("common.play_all")}</span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={shuffle}
                  disabled={empty}
                  className={`${HERO_BUTTON_CLASS} ${HERO_GLASS_BUTTON_CLASS} !w-[52px] !p-0 text-text-primary`}
                  title={t("common.shuffle")}
                >
                  <LuShuffle size={18} />
                </Button>
              </>
            }
            trailingActions={
              <>
                <TrackSearchField
                  search={search}
                  totalCount={tracks.length}
                  placeholder={t("track_search.placeholder_playlist")}
                  onSubmit={submitSearch}
                  className={HERO_GLASS_CLASS}
                />
                <TrackSortMenu sort={sort} disabled={tracks.length < 2} />
                {!empty && (
                  <Button
                    variant="secondary"
                    onClick={() => setRemoveAllOpen(true)}
                    disabled={importing}
                    className={`${HERO_BUTTON_CLASS} ${HERO_GLASS_BUTTON_CLASS} !w-[52px] !p-0 text-text-primary`}
                    title={t("library.local.remove_all")}
                    aria-label={t("library.local.remove_all")}
                  >
                    <LuTrash2 size={17} />
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => void chooseFiles()}
                  disabled={importing}
                  className={`${HERO_BUTTON_CLASS} ${HERO_GLASS_BUTTON_CLASS} px-[22px]`}
                >
                  <AddLine
                    size={16}
                    className={importing ? "animate-pulse" : undefined}
                  />
                  <span className="truncate">
                    {importing
                      ? t("library.local.importing")
                      : t("library.local.add_files")}
                  </span>
                </Button>
              </>
            }
          />
        </div>

        <div
          className={cn(
            "mx-[4px] mt-[20px] shrink-0 grow overflow-hidden rounded-t-[14px] bg-black/[0.03] px-[8px] pt-[8px] dark:bg-white/[0.04]",
            !classicSurfaces && "backdrop-blur-xl",
          )}
          style={{
            marginBottom: "calc(var(--page-inset-bottom) * -1)",
            paddingBottom: "calc(var(--page-inset-bottom) + 16px)",
          }}
        >
          {isLoading ? null : tracks.length === 0 ? (
            <LocalTracksEmpty
              importing={importing}
              onAddFiles={() => void chooseFiles()}
            />
          ) : search.matches && search.matches.length === 0 ? (
            <TrackSearchEmpty
              query={search.activeQuery}
              onClear={() => search.setQuery("")}
            />
          ) : (
            <LocalTrackList
              entries={entries}
              queue={sort.sorted}
              highlight={search.activeQuery || undefined}
              scrollRef={scrollRef}
            />
          )}
        </div>
      </div>
      <RemoveAllLocalDialog
        open={removeAllOpen}
        onClose={() => setRemoveAllOpen(false)}
      />
    </div>
  );
}
