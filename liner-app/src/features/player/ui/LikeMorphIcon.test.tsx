import React, { act } from "react";
import { describe, it, expect } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { HeartFill, HeartLine } from "@mingcute/react";
import { LikeMorphIcon } from "./LikeMorphIcon";

// @ts-expect-error - act support flag in vitest browserless DOM environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pathOf(host: HTMLElement): string | null {
  // mingcute icons render a transparent bounding-box path first and the real
  // shape second — compare the actual shape
  const paths = host.querySelectorAll("svg path");
  const last = paths[paths.length - 1];
  return last?.getAttribute("d") ?? null;
}

function mount(jsx: React.ReactElement): { host: HTMLElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(jsx);
  });
  return { host, root };
}

function unmount(mounted: { host: HTMLElement; root: Root }): void {
  mounted.root.unmount();
  mounted.host.remove();
}

describe("LikeMorphIcon", () => {
  it("renders the same mingcute heart as the mini player when not liked", () => {
    const expected = mount(<HeartLine size={20} />);
    const actual = mount(<LikeMorphIcon liked={false} size={20} />);
    expect(pathOf(actual.host)).toBeTruthy();
    // must not regress to the old plus/check morph that looked identical to
    // the add-to-playlist "+" button next to it
    expect(pathOf(actual.host)).not.toContain("M5 12H19");
    expect(pathOf(actual.host)).toBe(pathOf(expected.host));
    unmount(expected);
    unmount(actual);
  });

  it("renders the filled heart when liked", () => {
    const expected = mount(<HeartFill size={20} />);
    const actual = mount(<LikeMorphIcon liked size={20} />);
    expect(pathOf(actual.host)).toBeTruthy();
    expect(pathOf(actual.host)).toBe(pathOf(expected.host));
    unmount(expected);
    unmount(actual);
  });

  it("changes the icon when the liked state flips", () => {
    const mounted = mount(<LikeMorphIcon liked={false} size={20} />);
    const outline = pathOf(mounted.host);
    act(() => {
      mounted.root.render(<LikeMorphIcon liked size={20} />);
    });
    const filled = pathOf(mounted.host);
    expect(outline).toBeTruthy();
    expect(filled).toBeTruthy();
    // mingcute Line/Fill share the bounding box but differ in the heart shape
    expect(outline).not.toBe(filled);
    unmount(mounted);
  });
});
