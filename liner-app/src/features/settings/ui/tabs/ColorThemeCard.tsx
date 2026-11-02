const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

export function ColorThemeCard({
  name,
  swatch,
  active,
  disabled = false,
  disabledReason,
  onSelect,
}: {
  name: string;
  /** CSS background for the swatch (gradient or solid). */
  swatch: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      aria-pressed={active}
      aria-disabled={disabled}
      title={disabled ? disabledReason : name}
      className={`group flex min-w-0 flex-col gap-[6px] border-0 bg-transparent p-0 text-left ${
        disabled ? "cursor-not-allowed opacity-40 select-none" : "cursor-pointer"
      }`}
    >
      <span
        className={`relative block h-[54px] w-full overflow-hidden rounded-[10px] border transition-all ${
          disabled
            ? "border-border-primary"
            : active
              ? "border-white/80 ring-2 ring-white/60"
              : "border-white/10 group-hover:border-white/35"
        }`}
        style={{ background: swatch }}
      >
        {active ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white/85 shadow-sm">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M2 6.5L4.5 9L10 3"
                  stroke="#1a1a1a"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        ) : null}
      </span>
      <span
        className={`block truncate text-[11.5px] leading-none ${
          active ? "text-text-primary" : "text-text-secondary"
        }`}
        style={{ ...font, fontWeight: active ? 500 : 400 }}
      >
        {name}
      </span>
    </button>
  );
}
