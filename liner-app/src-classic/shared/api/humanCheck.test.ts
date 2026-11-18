import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HumanCheckCancelledError,
  humanCheckFrameBlocked,
  humanCheckOrigins,
  humanCheckPageUrl,
  runHumanCheck,
  setHumanCheckPrompt,
} from "./humanCheck";

describe("human check", () => {
  afterEach(() => setHumanCheckPrompt(null));

  it("frames the upstream page — the widget is domain-locked (110200)", () => {
    expect(humanCheckPageUrl("register")).toBe(
      "https://api.tryliner.fun/v1/auth/verify?action=register",
    );
  });

  it("accepts messages from the upstream origin", () => {
    expect(humanCheckOrigins()).toContain("https://api.tryliner.fun");
  });

  it("treats the browser (non-Electron) context as frame-blocked", () => {
    // vitest runs in a DOM environment without window.linerElectron, i.e.
    // exactly the website-port case: the widget can never render there
    expect(humanCheckFrameBlocked()).toBe(true);
  });

  it("asks nothing while the api has the check off", async () => {
    const prompt = vi.fn();
    setHumanCheckPrompt(prompt);
    await expect(runHumanCheck("login", "off")).resolves.toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("hands the token from the panel to the request", async () => {
    setHumanCheckPrompt(async () => "token");
    await expect(runHumanCheck("register", "required")).resolves.toBe("token");
  });

  it("goes on without a token when an optional check is skipped", async () => {
    setHumanCheckPrompt(async () => null);
    await expect(runHumanCheck("login", "optional")).resolves.toBeUndefined();
  });

  it("stops the sign-in when a required check is closed", async () => {
    setHumanCheckPrompt(async () => null);
    await expect(runHumanCheck("login", "required")).rejects.toBeInstanceOf(
      HumanCheckCancelledError,
    );
  });
});
