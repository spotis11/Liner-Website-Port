import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startLiquidGlass,
  stopLiquidGlass,
  LIQUID_GLASS_PANE_ATTR,
  __liquidGlassControllerInternals,
} from "./liquidGlassController";

// The real engine never loads in jsdom (no GPU); the mock stands in so the
// controller's lifecycle logic is exercised against a contract-true fake.
// (Names must start with "mock" for vitest's hoisted factory.)
const mockRegisterDynamic = vi.fn();
const mockDestroy = vi.fn();
const mockLiquidGL = vi.fn(() => ({ destroy: mockDestroy }));

vi.mock("liquid-gl", () => ({
  default: Object.assign(mockLiquidGL, {
    registerDynamic: mockRegisterDynamic,
  }),
}));

async function settle(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function addPane(id: string, parent: HTMLElement): HTMLElement {
  const pane = document.createElement("div");
  pane.setAttribute(LIQUID_GLASS_PANE_ATTR, id);
  parent.appendChild(pane);
  return pane;
}

describe("liquidGlassController", () => {
  let host: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(async () => {
    stopLiquidGlass();
    await settle(260);
    document.body.innerHTML = "";
  });

  it("attaches a lens for every pane in the DOM", async () => {
    const pane = addPane("pane-a", host);
    const stop = await startLiquidGlass();
    await settle(300);
    expect(__liquidGlassControllerInternals.paneCount).toBe(1);
    expect(mockLiquidGL).toHaveBeenCalledTimes(1);
    const options = (
      mockLiquidGL.mock.calls as unknown as Array<
        [Record<string, unknown>]
      >
    )[0]![0];
    expect(options.target).toBe(`[${LIQUID_GLASS_PANE_ATTR}="pane-a"]`);
    expect(options.snapshot).toBe("body");
    expect(typeof options.refraction).toBe("number");
    stop();
  });

  it("picks up panes that mount after the engine started", async () => {
    await startLiquidGlass();
    await settle(50);
    expect(__liquidGlassControllerInternals.paneCount).toBe(0);
    addPane("pane-late", host);
    await settle(320);
    expect(__liquidGlassControllerInternals.paneCount).toBe(1);
    expect(mockLiquidGL).toHaveBeenCalled();
  });

  it("destroys the lens when its pane leaves the DOM", async () => {
    const pane = addPane("pane-doomed", host);
    await startLiquidGlass();
    await settle(300);
    expect(__liquidGlassControllerInternals.paneCount).toBe(1);
    pane.remove();
    await settle(320);
    expect(__liquidGlassControllerInternals.paneCount).toBe(0);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("re-captures the snapshot on inner-container scroll (capture phase)", async () => {
    addPane("pane-scroll", host);
    await startLiquidGlass();
    await settle(300);
    mockRegisterDynamic.mockClear();
    // scroll events do not bubble, but they DO traverse the capture phase —
    // the exact path the controller listens on.
    const scroller = document.createElement("div");
    host.appendChild(scroller);
    scroller.dispatchEvent(
      new Event("scroll", { bubbles: false, composed: false }),
    );
    await settle(300);
    expect(mockRegisterDynamic).toHaveBeenCalledWith("main");
  });

  it("stop() tears every pane down and is idempotent", async () => {
    addPane("pane-stop", host);
    await startLiquidGlass();
    await settle(300);
    expect(__liquidGlassControllerInternals.paneCount).toBe(1);
    stopLiquidGlass();
    stopLiquidGlass();
    expect(__liquidGlassControllerInternals.paneCount).toBe(0);
    expect(mockLiquidGL.mock.calls.length).toBe(1);
  });
});
