import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@/languages";
import EnvironmentWarning from "./EnvironmentWarning";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderWarning(withElectronBridge: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  if (withElectronBridge) {
    (window as unknown as Record<string, unknown>).linerElectron = {};
  }
  act(() => {
    root.render(
      <I18nProvider>
        <EnvironmentWarning />
      </I18nProvider>,
    );
  });
  return { host, root };
}

// Website port decision: the "App should run inside Electron" banner is a
// desktop-ism (like the minimize/maximize/close controls). The web build
// renders nothing, whether or not the Electron bridge is present.
describe("EnvironmentWarning (website port)", () => {
  it("renders nothing in a plain browser", () => {
    const { host, root } = renderWarning(false);
    try {
      expect(host.textContent).toBe("");
      expect(host.querySelector("button")).toBeNull();
    } finally {
      root.unmount();
      host.remove();
      delete (window as unknown as Record<string, unknown>).linerElectron;
    }
  });

  it("renders nothing inside electron too", () => {
    const { host, root } = renderWarning(true);
    try {
      expect(host.textContent).toBe("");
      expect(host.querySelector("button")).toBeNull();
    } finally {
      root.unmount();
      host.remove();
      delete (window as unknown as Record<string, unknown>).linerElectron;
    }
  });
});
