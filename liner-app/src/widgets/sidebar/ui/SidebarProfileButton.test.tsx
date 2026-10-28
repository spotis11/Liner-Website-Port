import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";

// authStore pulls the player barrel, which drags lottie/canvas UI that jsdom
// cannot load; the profile button never touches it (same mock as authStore.test).
const playerEngineMock = vi.hoisted(() => ({
  stopAndClear: vi.fn(async () => {}),
}));
vi.mock("@/features/player", () => ({ playerEngine: playerEngineMock }));

import { SidebarProfileButton } from "./SidebarProfileButton";
import { useModalStore } from "@/features/library/store/modalStore";
import { useAuthStore } from "@/features/auth/store/authStore";

describe("SidebarProfileButton", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    useModalStore.getState().closeSettings();
    useAuthStore.setState({ user: null });
  });

  async function render(): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container!);
    await act(async () => {
      root!.render(<SidebarProfileButton />);
    });
    return container!;
  }

  it("opens the settings modal on the Account tab when clicked", async () => {
    const el = await render();
    const button = el.querySelector('button[aria-label="Profile"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const state = useModalStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsRequestedTab).toBe("Account");
  });

  it("renders the user avatar when signed in", async () => {
    useAuthStore.setState({
      user: {
        id: "u1",
        username: "jay",
        displayName: "Jay",
        avatarUrl: null,
      },
    });
    const el = await render();
    // The profile button is the only one in this tree; the avatar renders
    // inside it (img or initials fallback).
    const button = el.querySelector('button[aria-label="Profile"]');
    expect(button).not.toBeNull();
    expect(button!.childElementCount).toBeGreaterThan(0);
  });
});
