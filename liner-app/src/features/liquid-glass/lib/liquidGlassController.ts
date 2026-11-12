// Liquid Glass controller — the runtime that turns the decorative pane
// elements rendered by <LiquidGlassPane /> into real liquidGL lenses.
//
// HOW IT WORKS (why the pane is a position:fixed child of the glassified
// component):
//   liquidGL appends its shared render canvas to the lens's nearest
//   fixed/sticky ancestor (the "anchor"). Making the pane itself fixed means
//   the canvas is appended INSIDE the pane — the glass therefore paints
//   exactly over the pane rect, which the controller keeps glued to the
//   component's own rect (measured each frame, self-correcting so even a
//   transformed ancestor — e.g. the sliding queue drawer — cannot desync it).
//   The component's live DOM stays entirely OUTSIDE the lens, so every
//   control on it keeps working: liquidGL sets pointer-events:none on lens
//   elements, so glassifying interactive chrome directly would kill it.
//   The glassified component root is additionally marked data-liquid-ignore
//   so its own content is excluded from the refraction snapshot — the glass
//   refracts only the page beneath it, and the live content stays crisp.
//
// GEOMETRY: the controller writes CSS custom properties (--lg-left/top/
// width/height/radius) consumed by the [data-liquid-glass-pane] rule in
// globals.css — React never manages those properties, so controller writes
// and React reconciliation cannot clobber each other.
//
// DYNAMIC CONTENT: liquidGL only watches window scroll; this app scrolls
// inside inner containers. The controller therefore:
//   - registers <main> as a dynamic element (library MutationObserver ->
//     throttled recaptures when page content changes),
//   - listens to scroll events in the CAPTURE phase (inner-container scrolls
//     still reach window in capture) and triggers a debounced recapture,
//   - rescans panes on DOM mutations so mounted/unmounted chrome (queue
//     drawer opening, player bar hiding in fullscreen) gains/loses lenses,
//   - recaptures on route changes (hashchange).
//
// The controller is idempotent and fully teardown-able: stop() destroys
// every lens, removes listeners and clears all state.

export const LIQUID_GLASS_PANE_ATTR = "data-liquid-glass-pane";

/** Lens tuning — dark, Apple-ish glass over the app chrome. */
const LENS_OPTIONS = {
  snapshot: "body",
  resolution: 1.5,
  refraction: 0.045,
  aberration: 0.16,
  bevelDepth: 0.13,
  bevelWidth: 0.2,
  frost: 1.4,
  shadow: false,
  specular: true,
  reveal: "fade",
  tint: "rgba(10, 12, 20, 0.22)",
} as const;

type LiquidGLFn = {
  (options: Record<string, unknown>): unknown;
  registerDynamic?: (elements: string | Element | Element[]) => void;
};

type LensLike = { destroy: () => void };

interface PaneRecord {
  lens: LensLike | null;
  /** Geometry currently written into the pane (viewport px). */
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
    radius?: string;
  };
}

interface ControllerState {
  liquidGL: LiquidGLFn | null;
  panes: Map<Element, PaneRecord>;
  rafId: number | null;
  mutationObserver: MutationObserver | null;
  mutationTimer: number | null;
  scrollTimer: number | null;
  running: boolean;
  stop: boolean;
}

const state: ControllerState = {
  liquidGL: null,
  panes: new Map(),
  rafId: null,
  mutationObserver: null,
  mutationTimer: null,
  scrollTimer: null,
  running: false,
  stop: false,
};

function paneSelector(pane: Element): string {
  const id = pane.getAttribute(LIQUID_GLASS_PANE_ATTR) ?? "";
  return `[${LIQUID_GLASS_PANE_ATTR}=${JSON.stringify(id)}]`;
}

/** "Background changed" — ask every renderer to re-capture its snapshot. */
function requestRecapture(): void {
  const liquidGL = state.liquidGL;
  if (!liquidGL) return;
  try {
    // registerDynamic re-captures for every renderer. "main" is registered
    // once for its own MutationObserver-driven updates; calling it again on
    // scroll/route events is a cheap dedupe + full capture.
    liquidGL.registerDynamic?.("main");
  } catch {
    // Warnings when no renderer exists yet are never fatal.
  }
}

function scheduleScrollRecapture(): void {
  if (state.scrollTimer != null) return;
  state.scrollTimer = window.setTimeout(() => {
    state.scrollTimer = null;
    requestRecapture();
  }, 220);
}

/** Create the lens for one (new) pane element. */
function attachPane(pane: Element): void {
  const liquidGL = state.liquidGL;
  if (!liquidGL || state.panes.has(pane)) return;
  const record: PaneRecord = {
    lens: null,
    rect: { left: 0, top: 0, width: 0, height: 0 },
  };
  state.panes.set(pane, record);
  try {
    const lens = liquidGL({
      target: paneSelector(pane),
      ...LENS_OPTIONS,
    }) as LensLike | LensLike[] | undefined;
    record.lens = Array.isArray(lens) ? lens[0] ?? null : lens ?? null;
    try {
      liquidGL.registerDynamic?.("main");
    } catch {
      // Views without <main> (e.g. login) simply keep the boot snapshot.
    }
  } catch (err) {
    // A failing pane (unsupported browser, degenerate geometry) must never
    // take the app down — the component keeps its normal background.
    console.warn("[liquid-glass] pane skipped:", err);
  }
}

function detachPane(pane: Element): void {
  const record = state.panes.get(pane);
  if (!record) return;
  state.panes.delete(pane);
  try {
    record.lens?.destroy();
  } catch {
    // destroy is best-effort; the pane element is gone anyway.
  }
}

/** Sync lenses with the panes currently in the DOM. */
function rescanPanes(): void {
  const live = new Set(
    Array.from(document.querySelectorAll(`[${LIQUID_GLASS_PANE_ATTR}]`)),
  );
  for (const pane of live) attachPane(pane);
  for (const pane of Array.from(state.panes.keys())) {
    if (!live.has(pane) || !pane.isConnected) detachPane(pane);
  }
}

const scheduleRescan = (): void => {
  if (state.mutationTimer != null) return;
  state.mutationTimer = window.setTimeout(() => {
    state.mutationTimer = null;
    if (!state.running) return;
    rescanPanes();
  }, 240);
};

/**
 * Keep every pane glued to its parent component rect. position:fixed uses
 * viewport coordinates, but a transformed ancestor shifts the containing
 * block — so the loop self-corrects: it measures the pane's own rendered
 * rect and compensates the delta against what was last written.
 */
function syncGeometry(): void {
  if (!state.running) return;
  for (const [pane, record] of state.panes) {
    const anchor = pane.parentElement;
    if (!anchor || !anchor.isConnected) continue;
    const a = anchor.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    // Containing-block correction (fixed is viewport-based unless an
    // ancestor carries a transform): compensate the observed offset.
    const dx = record.rect.left - p.left;
    const dy = record.rect.top - p.top;
    const left = a.left + dx;
    const top = a.top + dy;
    const width = a.width;
    const height = a.height;
    const r = record.rect;
    if (
      r.left !== left ||
      r.top !== top ||
      r.width !== width ||
      r.height !== height
    ) {
      const style = (pane as HTMLElement).style;
      style.setProperty("--lg-left", `${left}px`);
      style.setProperty("--lg-top", `${top}px`);
      style.setProperty("--lg-width", `${width}px`);
      style.setProperty("--lg-height", `${height}px`);
      const radius = getComputedStyle(anchor).borderRadius;
      if (radius && radius !== r.radius) {
        style.setProperty("--lg-radius", radius);
        r.radius = radius;
      }
      r.left = left;
      r.top = top;
      r.width = width;
      r.height = height;
    }
  }
  state.rafId = requestAnimationFrame(syncGeometry);
}

/**
 * Start the liquid glass runtime. Resolves with a stop() that tears
 * everything down (idempotent; safe under React StrictMode double-mount).
 */
export async function startLiquidGlass(): Promise<() => void> {
  if (state.running) {
    state.stop = false;
    return stopLiquidGlass;
  }
  state.running = true;
  state.stop = false;

  try {
    const mod = await import("liquid-gl");
    // The library also installs itself on window.liquidGL (IIFE) — belt and
    // braces for bundlers that reshape the default export.
    const liquidGL: LiquidGLFn | undefined =
      (mod.default as unknown as LiquidGLFn | undefined) ??
      (window as unknown as { liquidGL?: LiquidGLFn }).liquidGL;
    if (typeof window === "undefined" || typeof liquidGL !== "function") {
      state.running = false;
      return stopLiquidGlass;
    }
    state.liquidGL = liquidGL;
  } catch (err) {
    // The chunk failing to load (offline first paint, blocked GPU) simply
    // leaves the chrome with its normal background.
    console.warn("[liquid-glass] engine unavailable:", err);
    state.running = false;
    return stopLiquidGlass;
  }

  if (state.stop) {
    // Disabled while the chunk was loading.
    state.running = false;
    return stopLiquidGlass;
  }

  rescanPanes();

  const onScroll = (): void => scheduleScrollRecapture();
  window.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  } as AddEventListenerOptions);
  window.addEventListener("hashchange", requestRecapture);

  const observer = new MutationObserver(scheduleRescan);
  observer.observe(document.body, { childList: true, subtree: true });
  state.mutationObserver = observer;

  state.rafId = requestAnimationFrame(syncGeometry);

  return () => {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("hashchange", requestRecapture);
    stopLiquidGlass();
  };
}

export function stopLiquidGlass(): void {
  state.stop = true;
  state.running = false;
  if (state.rafId != null) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  if (state.mutationTimer != null) clearTimeout(state.mutationTimer);
  state.mutationTimer = null;
  if (state.scrollTimer != null) clearTimeout(state.scrollTimer);
  state.scrollTimer = null;
  state.mutationObserver?.disconnect();
  state.mutationObserver = null;
  for (const pane of Array.from(state.panes.keys())) detachPane(pane);
  state.panes.clear();
  state.liquidGL = null;
}

/** Test seam: read controller internals without exporting raw state. */
export const __liquidGlassControllerInternals = {
  get paneCount(): number {
    return state.panes.size;
  },
};
