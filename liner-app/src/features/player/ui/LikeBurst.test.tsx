import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error - act support flag in vitest browserless DOM environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LikeBurstOverlay", () => {
  it("portals the fixed animation canvas to the viewport root", async () => {
    vi.stubGlobal("Path2D", class Path2DMock {});
    const { LikeBurstOverlay } = await import("./LikeBurst");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    act(() => root.render(<LikeBurstOverlay />));

    const canvas = document.body.querySelector("canvas[data-like-burst]");
    expect(canvas).not.toBeNull();
    expect(canvas?.parentElement).toBe(document.body);
    expect(canvas?.classList.contains("fixed")).toBe(true);

    act(() => root.unmount());
    host.remove();
  });

  it("draws the red burst ring at the viewport midpoint", async () => {
    vi.stubGlobal("Path2D", class Path2DMock {});
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(1000);

    const gradient = { addColorStop: vi.fn() };
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      createRadialGradient: vi.fn(() => gradient),
      fillRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      fill: vi.fn(),
      restore: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );

    const { LikeBurstOverlay, launchLikeBurst } = await import("./LikeBurst");
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.getBoundingClientRect = () => new DOMRect(20, 30, 40, 40);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => root.render(<LikeBurstOverlay />));
    launchLikeBurst(button);
    act(() => nextFrame?.(1500));

    expect(context.arc).toHaveBeenCalled();
    expect(context.arc.mock.calls[0]?.[0]).toBe(window.innerWidth / 2);
    expect(context.arc.mock.calls[0]?.[1]).toBe(window.innerHeight / 2);

    act(() => root.unmount());
    host.remove();
    button.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
