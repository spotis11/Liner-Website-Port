// Minimal ambient declarations for the liquidGL library (liquid-gl on npm,
// https://github.com/naughtyduk/liquidGL). The package ships no types; the
// surface below is exactly what the Liquid Glass controller uses — the full
// option set is documented in the library README.

declare module "liquid-gl" {
  export interface LiquidGLOptions {
    /** CSS selector for the element(s) to glassify (required). */
    target: string;
    /** CSS selector for the snapshot area; <body> recommended. */
    snapshot?: string;
    /** Snapshot quality 0.1–3.0. */
    resolution?: number;
    /** Renderer chain: "auto" | "webgpu" | "webgl2" | "webgl". */
    engine?: string;
    zIndex?: number;
    content?: string | boolean;
    refraction?: number;
    aberration?: number;
    bevelDepth?: number;
    bevelWidth?: number;
    frost?: number;
    shadow?: boolean;
    specular?: boolean;
    reveal?: "none" | "fade";
    tilt?: boolean;
    tiltFactor?: number;
    tiltEase?: number;
    draggable?: boolean;
    interaction?: "none" | "fluid";
    interactionStrength?: number;
    interactionRadius?: number;
    interactionViscosity?: number;
    magnify?: number;
    tint?: string | null;
    helper?: boolean;
    on?: {
      init?: (instance: unknown) => void;
      dragstart?: (instance: unknown, info: { x: number; y: number }) => void;
      drag?: (instance: unknown, info: { x: number; y: number }) => void;
      dragend?: (instance: unknown, info: { x: number; y: number }) => void;
    };
  }

  export interface LiquidGLLens {
    destroy(): void;
    setTint(value: string): void;
    setDraggable(enabled: boolean): void;
  }

  type LiquidGLResult = LiquidGLLens | LiquidGLLens[] | undefined;

  function liquidGL(options?: LiquidGLOptions): LiquidGLResult;

  namespace liquidGL {
    function registerDynamic(
      elements: string | Element | Element[] | NodeList,
    ): void;
    function syncWith(config?: Record<string, unknown>): {
      lenis?: unknown;
      locomotiveScroll?: unknown;
    };
  }

  export default liquidGL;
}
