import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEqualizerStore } from "../store/equalizerStore";
import { EqualizerModal } from "./EqualizerModal";

/**
 * Tests for the "Audio Equalizer & Presets" modal:
 *  - renders the 10 band sliders, preamp and bass boost controls
 *  - the bypass toggle flips the store and dims the bands (disabled)
 *  - preset select applies a curve to the bands
 *  - double-clicking a band resets it to 0dB
 */

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        (props: Record<string, unknown>) => {
          const { animate, initial, transition, exit, ...rest } = props;
          void animate;
          void initial;
          void transition;
          void exit;
          return React.createElement(tag, rest);
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// render Dialog content inline (the real one portals into document.body)
vi.mock("@/shared/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/ui")>();
  return {
    ...actual,
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (open ? <div data-testid="dialog">{children}</div> : null),
  };
});

describe("EqualizerModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    useEqualizerStore.setState({
      bypassed: false,
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preampDb: 0,
      bassBoostPct: 0,
      preset: "flat",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  const render = (open = true) => {
    act(() => {
      root.render(<EqualizerModal open={open} onOpenChange={() => {}} />);
    });
  };

  const band = (index: number): HTMLElement => {
    const el = container.querySelectorAll<HTMLElement>("[data-eq-band]")[index];
    if (!el) throw new Error(`band ${index} not found`);
    return el;
  };

  it("renders 10 bands + preamp/bass controls when open", () => {
    render(true);
    expect(container.querySelectorAll("[data-eq-band]")).toHaveLength(10);
    expect(container.querySelector('[role="slider"][aria-label="Master Preamp"]'))
      .not.toBeNull();
    expect(container.textContent).toContain("0.0 dB");
    expect(container.textContent).toContain("0%");
  });

  it("renders nothing when closed", () => {
    render(false);
    expect(container.querySelectorAll("[data-eq-band]")).toHaveLength(0);
  });

  it("bypass toggle disables the bands and flips the store", () => {
    render(true);
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Equalizer Bypassed"], input[aria-label="Equalizer Bypassed"], [role="switch"][aria-label="Equalizer Bypassed"]',
    );
    expect(toggle).not.toBeNull();
    act(() => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useEqualizerStore.getState().bypassed).toBe(true);
    expect(band(0).getAttribute("tabindex")).toBe("-1");
  });

  it("double-click resets a band to 0dB", () => {
    act(() => useEqualizerStore.getState().setBand(3, 6));
    render(true);
    expect(band(3).getAttribute("aria-valuenow")).toBe("6");
    act(() => {
      band(3).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(useEqualizerStore.getState().bands[3]).toBe(0);
    expect(band(3).getAttribute("aria-valuenow")).toBe("0");
  });

  it("keyboard arrows nudge a band by 1dB", () => {
    render(true);
    act(() => {
      band(2).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(useEqualizerStore.getState().bands[2]).toBe(1);
    act(() => {
      band(2).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(useEqualizerStore.getState().bands[2]).toBe(0);
  });

  it("editing a band marks the preset as custom", () => {
    render(true);
    act(() => useEqualizerStore.getState().setBand(0, 7));
    expect(useEqualizerStore.getState().preset).toBe("custom");
    act(() => useEqualizerStore.getState().applyPreset("flat"));
    expect(useEqualizerStore.getState().preset).toBe("flat");
    expect(useEqualizerStore.getState().bands.every((g) => g === 0)).toBe(true);
  });
});
