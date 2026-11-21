import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarCollapseStore } from "./sidebarCollapseStore";

const STORAGE_KEY = "liner.sidebar.collapsed";

describe("sidebarCollapseStore", () => {
  beforeEach(() => {
    localStorage.clear();
    // reset between tests: collapsed=false default, re-hydrates from storage
    useSidebarCollapseStore.setState({ collapsed: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to expanded", () => {
    expect(useSidebarCollapseStore.getState().collapsed).toBe(false);
  });

  it("toggles collapsed and persists it", () => {
    useSidebarCollapseStore.getState().toggleCollapsed();
    expect(useSidebarCollapseStore.getState().collapsed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");

    useSidebarCollapseStore.getState().toggleCollapsed();
    expect(useSidebarCollapseStore.getState().collapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  it("setCollapsed writes the given value and persists it", () => {
    useSidebarCollapseStore.getState().setCollapsed(true);
    expect(useSidebarCollapseStore.getState().collapsed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("hydrates collapsed=true from persisted storage on a fresh load", async () => {
    localStorage.setItem(STORAGE_KEY, "1");
    vi.resetModules();
    const { useSidebarCollapseStore: freshStore } = await import(
      "./sidebarCollapseStore"
    );
    expect(freshStore.getState().collapsed).toBe(true);
  });
});
