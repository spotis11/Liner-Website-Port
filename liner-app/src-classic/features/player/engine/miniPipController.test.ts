import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isMiniPipSupported,
  openMiniPip,
  closeMiniPip,
  attachMiniPipAutoBehavior,
  isMiniPipOpen,
} from "./miniPipController";
import { usePlayerStore } from "../store/playerStore";

// The controller dynamically imports the pip player component; a dummy keeps
// these tests focused on the controller itself (no real pip UI tree).
vi.mock("../ui/MiniPipPlayer", () => ({ default: () => null }));

function setHiddenVisibility(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    value: hidden ? "hidden" : "visible",
    configurable: true,
  });
}

interface FakePipWindow extends Window {
  __close: ReturnType<typeof vi.fn>;
}

/**
 * Minimal stand-in for the Document Picture-in-Picture window. `createElement`
 * delegates to the real jsdom document so createRoot gets a real element.
 */
function makeFakePipWindow(): FakePipWindow {
  const pip = {
    closed: false,
    title: "",
    document: {
      head: { appendChild: vi.fn() },
      body: {
        appendChild: vi.fn(),
        classList: { add: vi.fn() },
        style: {},
      },
      documentElement: { setAttribute: vi.fn(), classList: { add: vi.fn() } },
      createElement: (tag: string) => document.createElement(tag),
    },
    addEventListener: vi.fn(),
    close: vi.fn(() => {}),
  } as unknown as FakePipWindow;
  return pip;
}

function installFakePipApi(): FakePipWindow[] {
  const created: FakePipWindow[] = [];
  Object.defineProperty(window, "documentPictureInPicture", {
    configurable: true,
    value: {
      requestWindow: vi.fn(async () => {
        const pip = makeFakePipWindow();
        created.push(pip);
        return pip;
      }),
      window: null,
    },
  });
  return created;
}

describe("miniPipController", () => {
  afterEach(() => {
    closeMiniPip();
    setHiddenVisibility(false);
    delete (window as { documentPictureInPicture?: unknown })
      .documentPictureInPicture;
    usePlayerStore.setState({ miniPlayerEnabled: true });
    vi.restoreAllMocks();
  });

  it("reports the Document Picture-in-Picture API as unsupported in non-Chromium engines", () => {
    // jsdom has no documentPictureInPicture
    expect(isMiniPipSupported()).toBe(false);
    expect(isMiniPipOpen()).toBe(false);
  });

  it("openMiniPip resolves to null when the API is missing instead of throwing", async () => {
    await expect(openMiniPip()).resolves.toBeNull();
  });

  it("closeMiniPip is safe to call with no window open", () => {
    expect(() => closeMiniPip()).not.toThrow();
  });

  it("attachMiniPipAutoBehavior registers listeners and detaches cleanly", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const detach = attachMiniPipAutoBehavior();
    expect(typeof detach).toBe("function");
    expect(addSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    // Hidden tab without a playing track must be a no-op.
    setHiddenVisibility(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isMiniPipOpen()).toBe(false);

    detach();
    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });

  it("ignores tab-hide detection when no track is loaded", () => {
    usePlayerStore.setState({ currentTrack: null, status: "idle" });
    const detach = attachMiniPipAutoBehavior();
    setHiddenVisibility(true);
    expect(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    ).not.toThrow();
    expect(isMiniPipOpen()).toBe(false);
    detach();
  });

  it("openMiniPip refuses to open while the miniplayer is disabled in Settings", async () => {
    const created = installFakePipApi();
    usePlayerStore.setState({ miniPlayerEnabled: false });

    await expect(openMiniPip()).resolves.toBeNull();
    expect(created).toHaveLength(0);
    const api = window.documentPictureInPicture as unknown as {
      requestWindow: ReturnType<typeof vi.fn>;
    };
    expect(api.requestWindow).not.toHaveBeenCalled();

    // Re-enabling the toggle lets it open again.
    usePlayerStore.setState({ miniPlayerEnabled: true });
    await openMiniPip();
    expect(created).toHaveLength(1);
    expect(isMiniPipOpen()).toBe(true);
  });

  it("returns to the Liner tab and closes an open miniplayer immediately", async () => {
    installFakePipApi();
    usePlayerStore.setState({
      miniPlayerEnabled: true,
      currentTrack: { id: "t1" } as never,
      status: "playing",
    });

    await openMiniPip();
    expect(isMiniPipOpen()).toBe(true);

    const detach = attachMiniPipAutoBehavior();

    // Hidden again while already open → stays open.
    setHiddenVisibility(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isMiniPipOpen()).toBe(true);

    // Back on the Liner tab → the miniplayer disappears, synchronously.
    setHiddenVisibility(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isMiniPipOpen()).toBe(false);

    detach();
  });

  it("closing the open miniplayer invokes the pip window's close", async () => {
    const created = installFakePipApi();
    usePlayerStore.setState({ miniPlayerEnabled: true });

    await openMiniPip();
    expect(created).toHaveLength(1);
    const pip = created[0];

    closeMiniPip();
    expect(pip.close).toHaveBeenCalled();
    expect(isMiniPipOpen()).toBe(false);
  });

  it("flipping the Settings toggle off closes an already-open miniplayer", async () => {
    const created = installFakePipApi();
    usePlayerStore.setState({ miniPlayerEnabled: true });

    await openMiniPip();
    const pip = created[0];
    expect(isMiniPipOpen()).toBe(true);

    const detach = attachMiniPipAutoBehavior();
    usePlayerStore.setState({ miniPlayerEnabled: false });

    expect(pip.close).toHaveBeenCalled();
    expect(isMiniPipOpen()).toBe(false);

    detach();
  });
});
