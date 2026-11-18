import { EntityHero, HeroEyebrow, HeroMeta, HERO_TITLE_CLASS, HERO_SUBTITLE_CLASS, HERO_BUTTON_CLASS, HERO_GLASS_BUTTON_CLASS, ListPanel } from "@/shared/ui";
import Button from "@/shared/ui/Button";
import SongCardWithMenu from "@/features/player/ui/SongCardWithMenu";
import TrackTableHeader from "./TrackTableHeader";
import { LuShuffle } from "react-icons/lu";
import { PlayFill, Search3Line, SortDescendingLine } from "@mingcute/react";
import { usePlayerStore } from "@/features/player/store/playerStore";

/**
 * Dev-only design preview (route /_design, dev builds only): renders the real
 * collection-page components with stand-in data so the redesign can be
 * screenshotted without a session or API. Not reachable in production builds.
 */

function coverSvg(hue: number): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},28%,30%)'/><stop offset='1' stop-color='hsl(${hue + 40},30%,14%)'/></linearGradient></defs><rect width='96' height='96' fill='url(#g)'/></svg>`,
    )
  );
}

const PLAYLIST_COVER = coverSvg(210);

const TRACKS = [
  { title: "Paper lanterns", artists: "Mira Kessel", album: "Still water", added: "8 Nov 2026", dur: "4:12", hue: 208 },
  { title: "Тихий океан", artists: "Соломія Верес", album: "Велика хвиля", added: "8 Nov 2026", dur: "3:41", hue: 195 },
  { title: "Glass elevator", artists: "Nils Varga", album: "City of ambitions", added: "5 Nov 2026", dur: "3:05", hue: 230 },
  { title: "Slow city, part II", artists: "Clara Whitlow", album: "Nocturne for a slow city", added: "2 Nov 2026", dur: "7:48", hue: 260 },
  { title: "Нічні вогні", artists: "Сад на даху", album: "Герань", added: "30 Oct 2026", dur: "3:27", hue: 150 },
  { title: "Kites over the reservoir (extended night mix)", artists: "Ada Lindqvist", album: "Open water", added: "24 Oct 2026", dur: "6:02", hue: 178 },
  { title: "Amber static", artists: "Mira Kessel", album: "Still water", added: "18 Oct 2026", dur: "3:58", hue: 35 },
];

export default function DesignPreviewPage() {
  // stand-in "playing" track so the player bar renders in the preview
  const setPreviewTrack = usePlayerStore((state) => state.setCurrentTrack);
  const hasPreviewTrack = usePlayerStore((state) => state.currentTrack !== null);
  if (!hasPreviewTrack) {
    setPreviewTrack(
      {
        id: "preview-track-1",
        title: "Paper lanterns",
        artists: "Mira Kessel",
        coverUrl: PLAYLIST_COVER,
        durationMs: 252000,
        playCount: 0,
      },
      0,
    );
  }

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-transparent pt-(--page-inset-top) pb-(--page-inset-bottom)">
      <div className="shrink-0 pl-[16px] pr-[12px] pt-[8px]">
        <EntityHero
          cover={
            <img
              src={PLAYLIST_COVER}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          }
          eyebrow={<HeroEyebrow text="Playlist" />}
          title={<h1 className={HERO_TITLE_CLASS}>Late shift</h1>}
          subtitle={
            <p className={HERO_SUBTITLE_CLASS}>
              Things that sound right after midnight
            </p>
          }
          meta={
            <HeroMeta
              items={[
                <span
                  key="author"
                  className="inline-flex items-center gap-[6px]"
                >
                  <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-fill-strong text-[9px] font-[600] text-text-secondary">
                    OH
                  </span>
                  Olya Hnatiuk
                </span>,
                `${TRACKS.length} tracks`,
                "1 hr 3 min",
              ]}
            />
          }
          actions={
            <>
              <Button
                variant="primary"
                className={HERO_BUTTON_CLASS}
              >
                <PlayFill size={16} />
                <span>Play all</span>
              </Button>
              <Button
                variant="secondary"
                className={`${HERO_BUTTON_CLASS} ${HERO_GLASS_BUTTON_CLASS} px-[22px]`}
              >
                <LuShuffle size={18} />
                <span>Shuffle</span>
              </Button>
            </>
          }
          trailingActions={
            <>
              <div className="flex h-[36px] w-[220px] items-center gap-[10px] rounded-[10px] bg-fill px-[14px] text-text-tertiary">
                <Search3Line size={15} />
                <span className="text-body">Search in playlist</span>
              </div>
              <Button
                variant="secondary"
                className={`${HERO_BUTTON_CLASS} ${HERO_GLASS_BUTTON_CLASS} px-[22px]`}
              >
                <SortDescendingLine size={16} />
                <span>Sort</span>
              </Button>
            </>
          }
        />
      </div>

      <ListPanel>
        <section>
          <TrackTableHeader showAlbum showDate />
          <div className="flex flex-col">
            {TRACKS.map((track, index) => (
              <SongCardWithMenu
                key={track.title}
                id={`preview-${index}`}
                title={track.title}
                artists={track.artists}
                coverUrl={coverSvg(track.hue)}
                trackNumber={index + 1}
                albumName={track.album}
                dateAdded={track.added}
                duration={track.dur}
                durationMs={252000}
              />
            ))}
          </div>
        </section>
      </ListPanel>
    </div>
  );
}
