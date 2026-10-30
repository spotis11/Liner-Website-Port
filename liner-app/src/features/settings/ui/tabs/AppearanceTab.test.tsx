import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { AppearanceTab } from "./AppearanceTab";
import { useAppearanceStore } from "../../store/appearanceStore";
import { useCustomizationStore } from "../../store/customizationStore";
import { applyColorThemeToDocument } from "../../store/appearanceStore";

const mockSetTheme = vi.fn();
let mockTheme = "dark";
let mockResolvedTheme = "dark";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mockTheme,
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
}));

describe("AppearanceTab color themes", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = "dark";
    mockResolvedTheme = "dark";
    applyColorThemeToDocument(null);
    useAppearanceStore.getState().setColorTheme(null);
    useAppearanceStore.getState().setSameAsDevice(true);
    useCustomizationStore.getState().resetAll();
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
    document.body.innerHTML = "";
    applyColorThemeToDocument(null);
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<AppearanceTab />);
    });
  }

  function swatches(): HTMLButtonElement[] {
    return Array.from(
      container!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ).filter((b) => !b.hasAttribute("aria-label"));
  }

  function swatchByName(name: string): HTMLButtonElement | undefined {
    return swatches().find((b) =>
      (b.textContent ?? "").includes(name),
    );
  }

  it("renders the device-theme toggle and all 26 swatches", () => {
    mount();
    const toggle = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Same as device theme"]',
    );
    expect(toggle).toBeTruthy();
    expect(swatches()).toHaveLength(26);
    for (const name of ["Light", "Black", "Solar Flare", "Ocean FM Dark", "Forest Glow"]) {
      expect(swatchByName(name), name).toBeTruthy();
    }
  });

  it("applies a color theme to the document without touching next-themes", () => {
    mount();
    const flare = swatchByName("Solar Flare")!;
    act(() => {
      flare.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useAppearanceStore.getState().colorThemeId).toBe("solar-flare");
    expect(document.documentElement.getAttribute("data-color-theme")).toBe("solar-flare");
    expect(
      document.documentElement.style.getPropertyValue("--accent-primary"),
    ).toBeTruthy();
    expect(mockSetTheme).not.toHaveBeenCalled();
    expect(flare.getAttribute("aria-pressed")).toBe("true");
  });

  it("removes a color theme and any wallpaper when switching to Light/Black", () => {
    useAppearanceStore.getState().setColorTheme("solar-flare");
    mount();
    const light = swatchByName("Light")!;
    act(() => {
      light.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockSetTheme).toHaveBeenCalledWith("light");
    expect(useAppearanceStore.getState().colorThemeId).toBeNull();
    expect(useAppearanceStore.getState().sameAsDevice).toBe(false);
    expect(document.documentElement.getAttribute("data-color-theme")).toBeNull();

    mockSetTheme.mockClear();
    useAppearanceStore.getState().setColorTheme("teal-lagoon");
    const black = swatchByName("Black")!;
    act(() => {
      black.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    expect(useAppearanceStore.getState().colorThemeId).toBeNull();
  });

  it("clicking the active theme again deselects it", () => {
    useAppearanceStore.getState().setColorTheme("teal-lagoon");
    mount();
    const teal = swatchByName("Teal Lagoon")!;
    expect(teal.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      teal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppearanceStore.getState().colorThemeId).toBeNull();
    expect(document.documentElement.getAttribute("data-color-theme")).toBeNull();
  });

  it("clears an existing wallpaper when a color theme is applied (interlock)", () => {
    const store = useCustomizationStore.getState();
    act(() => {
      store.setBackgroundImage("data:image/png;base64,mock");
    });
    mount();
    const flare = swatchByName("Solar Flare")!;
    act(() => {
      flare.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useAppearanceStore.getState().colorThemeId).toBe("solar-flare");
    expect(useCustomizationStore.getState().backgroundImage).toBeNull();
  });

  it("same-as-device toggle drives next-themes system/manual modes", () => {
    useAppearanceStore.getState().setSameAsDevice(false);
    mount();
    const toggle = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Same as device theme"]',
    )!;
    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockSetTheme).toHaveBeenCalledWith("system");
    expect(useAppearanceStore.getState().sameAsDevice).toBe(true);

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockSetTheme).toHaveBeenLastCalledWith("dark");
    expect(useAppearanceStore.getState().sameAsDevice).toBe(false);
  });

  it("renders no Liquid Glass section and no legacy glass attributes", () => {
    mount();
    expect(container!.textContent).not.toContain("Liquid Glass");
    expect(
      container!.querySelector('button[aria-label="Liquid glass mode: Glass"]'),
    ).toBeNull();
    expect(
      document.documentElement.getAttribute("data-liquid-glass"),
    ).toBeNull();
  });
});
