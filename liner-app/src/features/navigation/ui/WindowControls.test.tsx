import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import WindowControls from "./WindowControls";

// Website port decision: minimize / maximize / close belong to the Electron
// window shell. On the website the browser provides the chrome, so
// WindowControls renders nothing regardless of props or bridge state.
describe("WindowControls (website port)", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (props?: React.ComponentProps<typeof WindowControls>) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<WindowControls {...props} />);
  };

  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  // Unmount every root: a leaked root keeps a scheduler callback alive that
  // fires after jsdom teardown ("window is not defined") and fails the run.
  afterEach(async () => {
    if (root) {
      await React.act(async () => {
        root.unmount();
      });
      root = undefined as unknown as Root;
    }
    if (container) {
      container.remove();
      container = undefined as unknown as HTMLDivElement;
    }
  });

  it("renders no buttons even when the electron bridge is present", () => {
    (window as unknown as Record<string, unknown>).linerElectron = {};
    render();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toBe("");
    delete (window as unknown as Record<string, unknown>).linerElectron;
  });

  it("renders no buttons with variant/style overrides", () => {
    render({ variant: "glass", style: { position: "absolute" } });
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("renders no buttons in fullscreen mode", () => {
    render({ isFullscreen: true });
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("renders no buttons when embedded", () => {
    render({ embedded: true, bare: true });
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
