import { describe, it, expect, beforeEach } from "vitest";
import { useModalStore } from "./modalStore";

describe("modalStore settings tab requests", () => {
  beforeEach(() => {
    useModalStore.getState().closeSettings();
  });

  it("openSettingsTo opens the modal and records the requested tab", () => {
    useModalStore.getState().openSettingsTo("Account");
    const state = useModalStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsRequestedTab).toBe("Account");
  });

  it("consumeSettingsRequestedTab clears the request without closing the modal", () => {
    useModalStore.getState().openSettingsTo("Playback");
    useModalStore.getState().consumeSettingsRequestedTab();
    const state = useModalStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsRequestedTab).toBeNull();
  });

  it("plain openSettings does not request a tab", () => {
    useModalStore.getState().openSettingsTo("About");
    useModalStore.getState().closeSettings();
    useModalStore.getState().openSettings();
    const state = useModalStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsRequestedTab).toBeNull();
  });

  it("closeSettings and toggleSettings reset any pending request", () => {
    useModalStore.getState().openSettingsTo("About");
    useModalStore.getState().closeSettings();
    expect(useModalStore.getState().settingsRequestedTab).toBeNull();

    useModalStore.getState().openSettingsTo("About");
    useModalStore.getState().toggleSettings();
    const state = useModalStore.getState();
    expect(state.settingsOpen).toBe(false);
    expect(state.settingsRequestedTab).toBeNull();
  });
});
