// evi-style hand-drawn doodles: squiggle underline, sparks, asterisk.
// All strokes use currentColor so the parent picks lime or orange.
// Ported from the desktop redesign (liner-new-ui source).

export function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 14"
      fill="none"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
    >
      <path
        d="M3 9.5c8-6 14-6 22-1.5s15 4.5 23-.5 15-5 23 0 14 5.5 22 .5 14-5.5 24-2"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Sparks({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M10 40c5-10 9-20 11-30"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M34 38c7-7 15-14 24-19"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Asterisk({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M24 6v36"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M8 15l32 18"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M40 15L8 33"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  );
}
