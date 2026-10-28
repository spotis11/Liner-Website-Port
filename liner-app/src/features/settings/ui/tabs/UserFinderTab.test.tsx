// Task 36: UserFinderTab — owner-only gating + lookup rendering.

import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";

const mockFindUser = vi.fn();
const mockToast = vi.fn();

// lottie-web (pulled in transitively) crashes under jsdom's null canvas —
// stub it before anything loads
vi.mock("lottie-web", () => ({
  default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) },
  loadAnimation: vi.fn(() => ({ destroy: vi.fn() })),
}));

vi.mock("../../lib/userFinderApi", () => ({
  findUser: (...args: unknown[]) => mockFindUser(...args),
  UserFinderError: class UserFinderError extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(`userfinder error: ${code}`);
      this.name = "UserFinderError";
    }
  },
}));

vi.mock("@/shared/ui", () => ({
  // light stubs — the real barrel pulls lottie-web which crashes under jsdom
  TextInput: ({ icon: _icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon?: unknown }) => (
    <input {...props} />
  ),
  UserAvatar: ({ user, size }: { user?: { username?: string | null } | null; size?: number }) => (
    <span data-testid="avatar" data-size={size} data-user={user?.username ?? ""} />
  ),
  useToast: () => ({ toast: mockToast, dismiss: vi.fn() }),
}));

vi.mock("@/shared/api/auth-session", () => ({
  getValidAccessToken: vi.fn(async () => "tok"),
}));

import { useAuthStore } from "@/features/auth";
import UserFinderTab from "./UserFinderTab";

const OWNER = {
  id: "u-owner",
  username: "jayzeyluna",
  email: "owner@test.dev",
};

const FOUND_RESULT = {
  found: true,
  username: "liner",
  profile: {
    email: "liner@test.dev",
    userId: "u-liner",
    displayName: "Liner",
    avatarUrl: null,
    bio: null,
    accountCreatedAt: "2025-03-01T10:00:00.000Z",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-10-01T00:00:00.000Z",
  },
  recentSongs: [
    {
      title: "Shivers",
      artist: "Netrum & Halvorsen",
      artwork: null,
      duration: 199,
      source: "youtube",
      playedAt: "2026-10-20T12:00:00.000Z",
    },
  ],
  ban: null,
  lastIp: { ip: "1.2.3.4", updatedAt: "2026-10-01T00:00:00.000Z" },
  frozenIps: [],
  isAdminAccount: false,
};

describe("UserFinderTab", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: OWNER } as never);
    mockFindUser.mockResolvedValue(FOUND_RESULT);
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
  });

  function mount(searchQuery?: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<UserFinderTab searchQuery={searchQuery} />);
    });
  }

  it("renders nothing for non-owner accounts", () => {
    useAuthStore.setState({ user: { id: "u1", username: "someone" } } as never);
    mount();
    expect(
      document.querySelector('[data-testid="user-finder-tab"]'),
    ).toBeNull();
  });

  it("renders the search UI for the site owner", () => {
    mount();
    const tab = document.querySelector('[data-testid="user-finder-tab"]');
    expect(tab).not.toBeNull();
    const input = tab!.querySelector("input");
    expect(input).not.toBeNull();
  });

  it("runs the lookup and renders profile + recent songs", async () => {
    mount();
    const tab = document.querySelector('[data-testid="user-finder-tab"]')!;
    const input = tab.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "liner");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(mockFindUser).toHaveBeenCalledWith("liner", "tok");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Liner");
    expect(text).toContain("liner@test.dev");
    expect(text).toContain("Shivers");
    expect(text).toContain("Netrum & Halvorsen");
  });

  it("shows the not-found note when nothing is known", async () => {
    mockFindUser.mockResolvedValue({ found: false, username: "ghost" });
    mount();
    const tab = document.querySelector('[data-testid="user-finder-tab"]')!;
    const input = tab.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "ghost");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("ghost");
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("blocks invalid usernames at the UI level (no API call, no toast)", async () => {
    mount();
    const tab = document.querySelector('[data-testid="user-finder-tab"]')!;
    const input = tab.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "not a valid user!!");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(mockFindUser).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
    // the Find button stays disabled for an invalid username
    const findButton = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").length > 0 && b.disabled,
    );
    expect(findButton).toBeTruthy();
  });
});
