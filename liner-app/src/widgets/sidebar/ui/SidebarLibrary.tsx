import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PlaylistFill, AddLine } from "@mingcute/react";
import { CoverCollage, usePlaylistsList, useModalStore } from "@/features/library";
import { useCachedTracksStore } from "@/features/library/cached";
import { useLikesCover } from "@/features/library/hooks/useLikesCover";
import { useSavedTracks } from "@/features/library/saved/hooks/useSavedTracks";
import cachedSongsCover from "@/assets/cached-songs-cover.svg";
import localFilesCover from "@/assets/local-files-cover.svg";
import { useOfflineModeStore } from "@/features/connectivity";
import CoverImage from "@/features/covers/ui/CoverImage";
import { useTranslation } from "@/languages";
import { cn } from "@/shared/lib";

interface SidebarLibraryItem {
  key: string;
  title: string;
  meta: string;
  href: string;
  cover: ReactNode;
}

function SvgCover({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="h-full w-full select-none object-cover"
    />
  );
}

function PlaylistCover({ urls, title }: { urls: string[]; title: string }) {
  if (urls.length >= 2)
    return <CoverCollage urls={urls} title={title} className="gap-0" />;
  if (urls.length === 1)
    return (
      <CoverImage
        src={urls[0]}
        alt={title}
        fill
        sizes="40px"
        className="object-cover transition-all duration-300 group-hover:brightness-[1.15]"
        draggable={false}
        unoptimized
      />
    );
  return <PlaylistFill size={18} className="text-border-alpha-33" />;
}

// fades the list edge only on the side that has more to scroll
function useScrollFade() {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 0;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setFade((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const mask = `linear-gradient(to bottom, ${
    fade.top ? "transparent, black 16px" : "black"
  }, ${fade.bottom ? "black calc(100% - 16px), transparent" : "black"})`;

  return { ref, style: { maskImage: mask, WebkitMaskImage: mask } };
}

function SidebarLibraryList({ items }: { items: SidebarLibraryItem[] }) {
  const { pathname, search } = useLocation();
  const fade = useScrollFade();
  const current = pathname + search;

  return (
    <div
      ref={fade.ref}
      style={fade.style}
      className="min-h-0 flex-1 overflow-y-auto px-[8px] pt-[8px] pb-[4px]"
    >
      <div className="flex flex-col gap-[2px]">
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.href}
            aria-label={item.title}
            aria-current={item.href === current ? "page" : undefined}
            className={cn(
              "group flex h-[44px] shrink-0 items-center gap-[12px] px-[8px] rounded-control transition-colors duration-150 no-underline",
              item.href === current
                ? "bg-fill"
                : "hover:bg-fill-subtle",
            )}
          >
            <div className="relative h-[40px] w-[40px] shrink-0 overflow-hidden rounded-control bg-fill flex items-center justify-center">
              {item.cover}
            </div>
            <div className="min-w-0 flex flex-col gap-[2px]">
              <span className="truncate text-[13.5px] font-[500] leading-[1.2] text-text-primary">
                {item.title}
              </span>
              <span className="truncate text-[11.5px] leading-[1.2] text-text-tertiary">
                {item.meta}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function OnlineSidebarLibrary() {
  const { t } = useTranslation();
  const likesCover = useLikesCover();
  const showCached = useCachedTracksStore((state) => state.visibleOnline);
  const { data } = usePlaylistsList();

  const items: SidebarLibraryItem[] = [
    {
      key: "likes",
      title: t("library.liked_songs"),
      meta: t("collection.playlist"),
      href: "/library/playlist?id=likes",
      cover: <SvgCover src={likesCover} />,
    },
    ...(showCached
      ? [
          {
            key: "cached",
            title: t("library.cached.title"),
            meta: t("common.songs"),
            href: "/library/cached",
            cover: <SvgCover src={cachedSongsCover} />,
          },
        ]
      : []),
    {
      key: "local",
      title: t("library.local.title"),
      meta: t("common.songs"),
      href: "/library/local",
      cover: <SvgCover src={localFilesCover} />,
    },
    ...(data?.playlists ?? []).map((playlist) => ({
      key: `playlist:${playlist.id}`,
      title: playlist.title,
      meta: t("collection.playlist"),
      href: `/library/playlist?id=${encodeURIComponent(playlist.id)}`,
      cover: (
        <PlaylistCover
          urls={
            playlist.coverUrls.length > 0
              ? playlist.coverUrls
              : playlist.coverUrl
                ? [playlist.coverUrl]
                : []
          }
          title={playlist.title}
        />
      ),
    })),
  ];

  return <SidebarLibraryList items={items} />;
}

function OfflineSidebarLibrary() {
  const { t } = useTranslation();
  const likesCover = useLikesCover();
  const { tracks: savedLikes, isLoading: savedLoading } = useSavedTracks();

  const items: SidebarLibraryItem[] = [
    ...(savedLikes.length > 0 || savedLoading
      ? [
          {
            key: "likes",
            title: t("library.liked_songs"),
            meta: t("collection.playlist"),
            href: "/library/saved",
            cover: <SvgCover src={likesCover} />,
          },
        ]
      : []),
    {
      key: "cached",
      title: t("library.cached.title"),
      meta: t("common.songs"),
      href: "/library/cached",
      cover: <SvgCover src={cachedSongsCover} />,
    },
    {
      key: "local",
      title: t("library.local.title"),
      meta: t("common.songs"),
      href: "/library/local",
      cover: <SvgCover src={localFilesCover} />,
    },
  ];

  return <SidebarLibraryList items={items} />;
}

/** Library shortcuts under the nav group, same set and order as the library page. */
export function SidebarLibrary() {
  const { t } = useTranslation();
  const offline = useOfflineModeStore((state) => state.offline);
  const openCreatePlaylist = useModalStore(
    (state) => state.openCreatePlaylist,
  );

  return (
    <section className="mt-[14px] flex min-h-0 flex-1 flex-col">
      <div className="flex h-[30px] shrink-0 items-center justify-between px-[18px]">
        <span className="text-[13px] font-[500] text-text-secondary select-none">
          {t("library.your_library")}
        </span>
        <button
          type="button"
          aria-label={t("common.create_empty_playlist")}
          title={t("common.create_empty_playlist")}
          onClick={() => openCreatePlaylist()}
          className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-secondary transition-colors duration-150 hover:bg-fill hover:text-text-primary cursor-pointer active:scale-[0.96]"
        >
          <AddLine size={16} />
        </button>
      </div>
      {offline ? <OfflineSidebarLibrary /> : <OnlineSidebarLibrary />}
    </section>
  );
}
