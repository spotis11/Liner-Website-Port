import { useMemo, useState } from "react";
import { CloseLine, Search2Line } from "@mingcute/react";
import Dialog from "@/shared/ui/Dialog";
import TextInput from "@/shared/ui/TextInput";
import { useTranslation } from "@/languages";
import {
  LYRIC_STYLES,
  LYRIC_STYLE_CATEGORIES,
  type LyricStyleCategory,
  type LyricStyleTheme,
} from "@/features/lyrics/styles/lyricStyles";
import { useLyricsStyleStore } from "@/features/lyrics/store/lyricsStyleStore";

const PREVIEW_TEXT = "in the style you pick";

/**
 * The lyric style gallery (Settings → Lyrics → Browse styles): category
 * tabs + search over a grid of live CSS previews, mirroring the desktop
 * app's style picker. Selecting a style applies it immediately.
 */
export function LyricsStyleBrowser({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (styleId: string) => void;
}) {
  const { t } = useTranslation();
  const currentId = useLyricsStyleStore((s) => s.styleId);
  const [category, setCategory] = useState<"all" | LyricStyleCategory>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LYRIC_STYLES.filter((style) => {
      if (category !== "all" && style.category !== category) return false;
      if (!q) return true;
      return (
        style.name.toLowerCase().includes(q) || style.category.includes(q)
      );
    });
  }, [category, query]);

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)} maxWidth={680}>
      <div className="flex flex-col gap-[14px] p-[20px]">
        <div className="flex items-center justify-between gap-[12px]">
          <div className="flex items-baseline gap-[8px]">
            <h3 className="m-0 text-[16px] font-[600] text-text-primary">
              {t("settings.lyrics.gallery_title") || "Lyrics"}
            </h3>
            <span className="rounded-full bg-fill px-[8px] py-[2px] text-[11px] text-text-tertiary">
              {t("settings.lyrics.styles_count", { count: LYRIC_STYLES.length }) ||
                `${LYRIC_STYLES.length} styles`}
            </span>
          </div>
          <button
            type="button"
            aria-label={t("common.close") || "Close"}
            onClick={onClose}
            className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-text-tertiary transition-colors hover:bg-fill hover:text-text-primary"
          >
            <CloseLine size={17} />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <div className="flex flex-wrap gap-[6px]">
            {(["all", ...LYRIC_STYLE_CATEGORIES] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                className={`cursor-pointer rounded-full border-0 px-[12px] py-[5px] text-[12px] font-[500] transition-colors ${
                  category === id
                    ? "bg-text-primary text-bg-primary"
                    : "bg-fill text-text-secondary hover:text-text-primary"
                }`}
              >
                {t(`settings.lyrics.category_${id}`) ||
                  (id === "all" ? "All" : id)}
              </button>
            ))}
          </div>
          <TextInput
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.lyrics.search_placeholder") || "Search styles..."}
            aria-label={t("settings.lyrics.search_placeholder") || "Search styles..."}
            className="!w-[190px] !gap-[6px] !rounded-full !bg-fill"
            icon={<Search2Line size={13} className="text-text-tertiary" />}
          />
        </div>

        <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-3">
          {filtered.map((style) => (
            <StyleCard
              key={style.id}
              style={style}
              selected={style.id === currentId}
              onSelect={() => onSelect(style.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full m-0 py-[18px] text-center text-[13px] text-text-tertiary">
              {t("search.no_results") || "No results"}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function StyleCard({
  style,
  selected,
  onSelect,
}: {
  style: LyricStyleTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex cursor-pointer flex-col gap-[6px] rounded-[14px] border-0 bg-transparent p-0 text-left outline-none transition-transform active:scale-[0.98] ${
        selected ? "ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-primary" : ""
      }`}
    >
      <span
        aria-hidden
        className="flex h-[86px] w-full items-center justify-center overflow-hidden rounded-[12px] bg-[#0a0a0c] px-[10px] text-center"
      >
        <span className="line-clamp-2 text-[14px] leading-[1.3]" style={previewCssFor(style)}>
          {PREVIEW_TEXT}
        </span>
      </span>
      <span className="flex items-center gap-[6px] px-[2px]">
        <span className="text-[12.5px] font-[500] text-text-primary">
          {style.name}
        </span>
        {selected && (
          <span className="text-[10px] text-accent-primary">
            ✓
          </span>
        )}
      </span>
    </button>
  );
}

/** CSS approximation of a theme for the gallery previews */
export function previewCssFor(style: LyricStyleTheme): React.CSSProperties {
  const css: React.CSSProperties = {
    fontFamily: style.family
      ? style.family
      : "var(--font-montserrat-family), Montserrat, sans-serif",
    fontWeight: style.weight ?? 600,
    fontStyle: style.italic ? "italic" : "normal",
    textTransform: style.uppercase ? "uppercase" : "none",
    letterSpacing: style.letterSpacing ? `${style.letterSpacing * 0.5}px` : undefined,
    wordSpacing: style.spread ? `${style.spread * 0.5}px` : undefined,
    color: style.activeColor ?? "#ffffff",
  };
  if (style.activeGradient) {
    css.backgroundImage = `linear-gradient(90deg, ${style.activeGradient[0]}, ${style.activeGradient[1]})`;
    css.WebkitBackgroundClip = "text";
    css.backgroundClip = "text";
    css.color = "transparent";
  }
  const glowColor = style.glowColor ?? style.activeColor;
  if (style.glitch) {
    css.textShadow =
      "2px 0 rgba(255, 64, 96, 0.8), -2px 0 rgba(64, 220, 255, 0.8)";
  } else if ((style.glowScale ?? 1) > 0 && style.constantGlowRem && glowColor) {
    css.textShadow = `0 0 ${(style.constantGlowRem * 14).toFixed(1)}px ${glowColor}`;
  } else if (style.id === "shadow") {
    css.textShadow = "0 2px 10px rgba(0, 0, 0, 0.9)";
  }
  return css;
}
