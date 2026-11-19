// LikeBurst — web port of Mochy-Music's LikeBurst.kt (Compose canvas
// animation, github.com/realidkroo/Mochy-Music). A heart leaves the like
// button, arcs up to the middle of the screen, thumps red with a ring and a
// spray of little hearts, floats, then dives home into the like button,
// which bounces as it lands. One overlay at the app root: every like button
// (mini player, fullscreen track info, queue rows) launches its own flight.
//
// Easing note: Compose's animateTo frames its tween from the CURRENT value
// on the very first frame — the heart is drawn at the button, box-sized,
// before the fast-start curves kick in. A rAF-driven port that samples the
// same cubic-bezier skips that frame and, because both curves start with a
// slope of ~4, the heart reads as teleporting away from the box. The
// launch window below holds position (at the box) and size (at glyph scale)
// for the first 90ms so the departure is VISIBLE, then hands over to the
// original Mochy curves for the arc, thump, float and dive home.
const LAUNCH_HOLD_MS = 90;
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const LIKE_RED = [255, 45, 85] as const; // #FF2D55
const LIKE_PINK = [255, 143, 171] as const; // #FF8FAB

const HEART_W = 104;
const HEART_ASPECT = 76 / 88;
const HEART_DRAW_OVERSIZE = 1.4;
const GLYPH_SCALE = 18 / HEART_W;
const PARTICLE_W = 14;
const PARTICLE_COUNT = 8;
const MAX_FLIGHTS = 4;

const TRAVEL_MS = 460;
const POP_MS = 460;
const THUMP_MS = 110;
const BURST_MS = 620;
const FLOAT_MS = 640;
const HOME_MS = 540;
const FLOAT_END_MS = TRAVEL_MS + FLOAT_MS; // heart starts home at 1100
const RED_DRAIN_START = TRAVEL_MS + 160;
const RED_DRAIN_MS = 520;

// cubic-bezier(0.3, 1.22, 0.5, 1) — shoots past the centre, settles back
const TRAVEL_EASING = makeCubicBezier(0.3, 1.22, 0.5, 1);
// cubic-bezier(0.34, 1.56, 0.64, 1) — the pop overshoot
const POP_EASING = makeCubicBezier(0.34, 1.56, 0.64, 1);
// linear-out slow-in — thump grow + burst
const SLOW_IN_EASING = makeCubicBezier(0, 0, 0.2, 1);
// cubic-bezier(0.5, -0.18, 0.7, 1) — hangs back, then dives home
const HOME_EASING = makeCubicBezier(0.5, -0.18, 0.7, 1);

/** Closed-form damped oscillation matching Compose's spring(). */
function springAt(
  seconds: number,
  initialDelta: number,
  stiffness: number,
  dampingRatio: number,
): number {
  const omega = Math.sqrt(stiffness);
  const dOmega = omega * Math.sqrt(Math.max(0, 1 - dampingRatio * dampingRatio));
  return (
    1 +
    initialDelta *
      Math.exp(-dampingRatio * omega * seconds) *
      Math.cos(dOmega * seconds)
  );
}

interface Particle {
  dx: number;
  dy: number;
  reach: number;
  scale: number;
  spin: number;
  color: string;
}

interface Flight {
  id: number;
  origin: { x: number; y: number };
  /** The like button this heart belongs to: it launches from its box and
   * dives back into it (Mochy's per-slot buttonBounds). */
  home: HTMLElement | null;
  seed: number;
  side: 1 | -1;
  particles: Particle[];
  start: number;
}

// --- module-level store (the overlay and the like buttons meet here) --------

let nextFlightId = 1;
const flights: Flight[] = [];
let rafHandle: number | null = null;

function makeParticles(seed: number): Particle[] {
  // deterministic per flight, like Random(flight.seed) in the Kotlin version
  let state = seed >>> 0 || 1;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const palette = [
    `rgb(${LIKE_RED.join(",")})`,
    `rgb(${LIKE_PINK.join(",")})`,
    "rgb(255,255,255)",
  ];
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle =
      (i * 2 * Math.PI) / PARTICLE_COUNT + (rand() - 0.5) * 0.5;
    return {
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      reach: 44 + rand() * 36,
      scale: 0.6 + rand() * 0.5,
      spin: (rand() - 0.5) * 70,
      color: palette[i % palette.length]!,
    };
  });
}

/**
 * Called when a like button LIKES the current track. The heart leaves THAT
 * button's box, arcs up to the middle of the screen, thumps, floats, and
 * dives back into the same box (which bounces as it lands).
 *
 * Pass the clicked button so the flight can start/end on it; every like
 * button in the app (mini player, fullscreen track info, queue rows) calls
 * this with its own ref.
 */
export function launchLikeBurst(home?: HTMLElement | null): void {
  if (typeof document === "undefined") return;
  const rect = home?.getBoundingClientRect();
  const origin = rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : {
        x: window.innerWidth / 2,
        y: window.innerHeight * 0.82,
      };
  if (flights.length >= MAX_FLIGHTS) flights.shift();
  const seed = (Math.random() * 4294967296) >>> 0;
  flights.push({
    id: nextFlightId++,
    origin,
    home: home ?? null,
    seed,
    side: seed % 2 === 0 ? 1 : -1,
    particles: makeParticles(seed),
    start: performance.now(),
  });
  if (rafHandle === null) rafHandle = requestAnimationFrame(tick);
}

// --- animation loop ---------------------------------------------------------

function tick(now: number): void {
  const canvas = document.querySelector(
    "canvas[data-like-burst]",
  ) as HTMLCanvasElement | null;
  for (let i = flights.length - 1; i >= 0; i--) {
    if (now - flights[i]!.start > FLOAT_END_MS + HOME_MS + 60) {
      flights.splice(i, 1);
    }
  }
  if (!canvas || flights.length === 0) {
    rafHandle = null;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = "none";
    }
    return;
  }
  canvas.style.display = "block";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Use the actual viewport midpoint. The former 44% target made the red
  // impact read as if it burst above the screen center.
  const center = { x: w / 2, y: h / 2 };

  for (const flight of flights) {
    drawFlight(ctx, flight, now, center);
  }
  rafHandle = requestAnimationFrame(tick);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function drawFlight(
  ctx: CanvasRenderingContext2D,
  flight: Flight,
  now: number,
  center: { x: number; y: number },
): void {
  const t = now - flight.start;
  const side = flight.side;
  // launch hold: the heart visibly leaves the box (see header note)
  const held = t < LAUNCH_HOLD_MS;

  // the box this heart came out of (per-flight, so any like button works)
  const homeRect = flight.home?.getBoundingClientRect() ?? null;
  const homeTarget = homeRect
    ? {
        x: homeRect.left + homeRect.width / 2,
        y: homeRect.top + homeRect.height / 2,
      }
    : flight.origin;

  // phase values ----------------------------------------------------------
  const travel = held
    ? 0
    : t < TRAVEL_MS
      ? TRAVEL_EASING(clamp01((t - LAUNCH_HOLD_MS) / (TRAVEL_MS - LAUNCH_HOLD_MS)))
      : 1;
  const pop = held
    ? 0
    : t < POP_MS
      ? POP_EASING(clamp01((t - LAUNCH_HOLD_MS) / (POP_MS - LAUNCH_HOLD_MS)))
      : 1;

  // thump: grow then spring back (spring k=360, ζ=0.3, from 1.32)
  const thumpGrow =
    t >= TRAVEL_MS && t < TRAVEL_MS + THUMP_MS
      ? 1 + 0.32 * SLOW_IN_EASING(clamp01((t - TRAVEL_MS) / THUMP_MS))
      : null;
  const springSeconds = Math.max(0, (t - TRAVEL_MS - THUMP_MS) / 1000);
  const scaleValue =
    thumpGrow ?? (t > TRAVEL_MS ? springAt(springSeconds, 0.32, 360, 0.3) : lerp(GLYPH_SCALE, 1, pop));

  const redness =
    t < TRAVEL_MS
      ? 0
      : t < TRAVEL_MS + THUMP_MS
        ? clamp01((t - TRAVEL_MS) / THUMP_MS)
        : t < RED_DRAIN_START
          ? 1
          : t < RED_DRAIN_START + RED_DRAIN_MS
            ? 1 - clamp01((t - RED_DRAIN_START) / RED_DRAIN_MS)
            : 0;

  const float = clamp01((t - TRAVEL_MS) / FLOAT_MS);
  const home = t > FLOAT_END_MS ? HOME_EASING(clamp01((t - FLOAT_END_MS) / HOME_MS)) : 0;

  // positions -------------------------------------------------------------
  // float: slow rise with a bob and a sway (Mochy bobAt)
  const bobAt = (f: number) => ({
    x: Math.sin(f * 2 * Math.PI * 1.25) * 7 * side,
    y: -Math.sin(f * 2 * Math.PI) * 9 - f * 16,
  });
  const floatEnd = { x: center.x + bobAt(1).x, y: center.y + bobAt(1).y };

  // travel: quad bezier arcing up and over from the origin
  const travelControl = {
    x: (flight.origin.x + center.x) / 2 + side * 48,
    y: Math.min(flight.origin.y, center.y) - 110,
  };
  const qt = travel;
  const inPos = {
    x:
      (1 - qt) * (1 - qt) * flight.origin.x +
      2 * (1 - qt) * qt * travelControl.x +
      qt * qt * center.x,
    y:
      (1 - qt) * (1 - qt) * flight.origin.y +
      2 * (1 - qt) * qt * travelControl.y +
      qt * qt * center.y,
  };

  // home: rises off the float, then dives into the button
  const homeControl = {
    x: lerp(floatEnd.x, homeTarget.x, 0.25),
    y: floatEnd.y - 90,
  };
  const qh = home;
  const homePos = {
    x:
      (1 - qh) * (1 - qh) * floatEnd.x +
      2 * (1 - qh) * qh * homeControl.x +
      qh * qh * homeTarget.x,
    y:
      (1 - qh) * (1 - qh) * floatEnd.y +
      2 * (1 - qh) * qh * homeControl.y +
      qh * qh * homeTarget.y,
  };

  const bob = bobAt(float);
  const pos =
    home !== 0
      ? homePos
      : float > 0
        ? { x: center.x + bob.x, y: center.y + bob.y }
        : inPos;

  const wobble = Math.sin(float * 2 * Math.PI * 1.5) * 8;
  const rotation =
    home !== 0
      ? lerp(wobble, 0, home) +
        Math.sin(home * Math.PI) * 16 * Math.sign(homeTarget.x - floatEnd.x)
      : float > 0
        ? wobble
        : lerp(-22 * side, 0, clamp01(travel));

  const homeShrink = lerp(1, GLYPH_SCALE, home * home);
  const s = scaleValue * homeShrink;
  const squash = Math.max(0, scaleValue - 1);
  const sx = s * (1 + squash * 0.28);
  const sy = s * (1 - squash * 0.14);
  const alpha = 1 - clamp01((home - 0.84) / 0.16);
  if (alpha <= 0 || s <= 0) return;

  // landing bounce on the button the heart belongs to (spring k=520, ζ=0.35)
  if (flight.home) {
    const landSeconds = Math.max(0, (t - FLOAT_END_MS) / 1000);
    if (t > FLOAT_END_MS && landSeconds < 1) {
      flight.home.style.transform = `scale(${springAt(landSeconds, 0.3, 520, 0.35)})`;
    } else if (flight.home.style.transform) {
      flight.home.style.transform = "";
    }
  }

  // burst ring + particle hearts ------------------------------------------
  const burstProgress = clamp01((t - TRAVEL_MS) / BURST_MS);
  if (burstProgress > 0 && burstProgress < 1) {
    const out = 1 - (1 - burstProgress) * (1 - burstProgress) * (1 - burstProgress);
    const fade = 1 - burstProgress;
    const ringColor = mix(LIKE_RED, [255, 255, 255], burstProgress * 0.6);
    ctx.beginPath();
    ctx.arc(center.x, center.y, HEART_W * 0.5 * lerp(0.7, 1.9, out), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ringColor},${0.7 * fade})`;
    ctx.lineWidth = lerp(5, 0.5, burstProgress);
    ctx.stroke();

    const pw = PARTICLE_W;
    const ph = pw * HEART_ASPECT;
    const startRadius = HEART_W * 0.32;
    for (const p of flight.particles) {
      const px = center.x + p.dx * startRadius + p.dx * p.reach * out;
      const py = center.y + p.dy * startRadius + p.dy * p.reach * out;
      drawHeart(ctx, px, py, pw * p.scale, ph * p.scale, p.spin * out, p.color, fade);
    }
  }

  // shadow + red glow ------------------------------------------------------
  const shadow = ctx.createRadialGradient(
    pos.x,
    pos.y + 8 * s,
    0,
    pos.x,
    pos.y + 8 * s,
    HEART_W * 0.75 * s,
  );
  shadow.addColorStop(0, `rgba(0,0,0,${0.22 * alpha})`);
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(
    pos.x - HEART_W * s,
    pos.y + 8 * s - HEART_W * s,
    HEART_W * 2 * s,
    HEART_W * 2 * s,
  );
  if (redness > 0.01) {
    const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, HEART_W * 0.95 * s);
    glow.addColorStop(0, `rgba(${LIKE_RED.join(",")},${0.45 * redness * alpha})`);
    glow.addColorStop(1, `rgba(${LIKE_RED.join(",")},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(pos.x - HEART_W * s, pos.y - HEART_W * s, HEART_W * 2 * s, HEART_W * 2 * s);
  }

  // the heart ---------------------------------------------------------------
  const color = mix([255, 255, 255], LIKE_RED, redness);
  drawHeart(
    ctx,
    pos.x,
    pos.y,
    HEART_W * HEART_DRAW_OVERSIZE * (sx / HEART_DRAW_OVERSIZE),
    HEART_W * HEART_DRAW_OVERSIZE * HEART_ASPECT * (sy / HEART_DRAW_OVERSIZE),
    rotation,
    `rgb(${color.join(",")})`,
    alpha,
  );
}

// 76×88 heart (the ic_untitled_heart viewport proportions)
const HEART_PATH = new Path2D(
  "M 38 84 C 20 66 0 48 0 27 C 0 10 11 0 24 0 C 31 0 36 3 38 9 " +
    "C 40 3 45 0 52 0 C 65 0 76 10 76 27 C 76 48 56 66 38 84 Z",
);

function heartPath(): Path2D {
  return HEART_PATH;
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotationDeg: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(w / 76, h / 88);
  // the 76×88 path starts at its top-left corner: pull it back by half so
  // (cx, cy) really is the heart's centre (Compose centres the glyph too)
  ctx.translate(-38, -44);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(heartPath());
  ctx.restore();
  ctx.globalAlpha = 1;
}

function mix(a: readonly number[], b: readonly number[], t: number): number[] {
  return [
    Math.round(lerp(a[0]!, b[0]!, t)),
    Math.round(lerp(a[1]!, b[1]!, t)),
    Math.round(lerp(a[2]!, b[2]!, t)),
  ];
}

/** CSS cubic-bezier solver (bisection on x, Newton fallback). */
function makeCubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (t: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(u) - t;
      if (Math.abs(x) < 1e-5) break;
      if (x > 0) hi = u;
      else lo = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  };
}

// --- React overlay -----------------------------------------------------------

export function LikeBurstOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    return () => {
      // unmounting the app clears flights + detaches the loop
      flights.length = 0;
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    };
  }, []);

  if (typeof document === "undefined") return null;

  // The player has animated/transformed ancestors. Portal the fixed canvas to
  // the document root so its viewport coordinates stay aligned with the like
  // button's getBoundingClientRect() origin on launch and return.
  return createPortal(
    <canvas
      ref={canvasRef}
      data-like-burst
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[80]"
      style={{ display: "none" }}
    />,
    document.body,
  );
}
