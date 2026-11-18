import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { LiquidGlassPane } from "./LiquidGlassPane";
import { LIQUID_GLASS_PANE_ATTR } from "../lib/liquidGlassController";

describe("LiquidGlassPane", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root!.unmount();
      });
      document.body.removeChild(container);
    }
    root = null;
    container = null;
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<LiquidGlassPane />);
    });
  }

  it("renders a fixed, inert pane skeleton", () => {
    mount();
    const pane = container!.querySelector(`[${LIQUID_GLASS_PANE_ATTR}]`);
    expect(pane).toBeTruthy();
    expect((pane as HTMLElement).style.position).toBe("fixed");
    expect((pane as HTMLElement).style.pointerEvents).toBe("none");
    expect(pane!.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives every mount a unique, CSS-selector-safe pane id", () => {
    mount();
    const first = container!.querySelector(`[${LIQUID_GLASS_PANE_ATTR}]`);
    const id = first!.getAttribute(LIQUID_GLASS_PANE_ATTR);
    expect(id).toBeTruthy();
    // The controller builds [data-liquid-glass-pane="<id>"] selectors — the
    // id must round-trip through querySelector.
    expect(
      document.querySelector(
        `[${LIQUID_GLASS_PANE_ATTR}=${JSON.stringify(id)}]`,
      ),
    ).toBe(first);
  });

  it("writes no geometry itself — the controller owns --lg-* vars", () => {
    mount();
    const pane = container!.querySelector(
      `[${LIQUID_GLASS_PANE_ATTR}]`,
    ) as HTMLElement;
    expect(pane.style.getPropertyValue("--lg-left")).toBe("");
    expect(pane.style.left).toBe("");
  });

  it("does not render React-managed children", () => {
    mount();
    const pane = container!.querySelector(`[${LIQUID_GLASS_PANE_ATTR}]`);
    expect(pane!.childElementCount).toBe(0);
  });
});
