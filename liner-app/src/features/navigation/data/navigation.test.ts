import { describe, it, expect } from "vitest";
import { sidebarNavItems } from "./navigation";

describe("sidebarNavItems", () => {
  it("keeps Settings and Changelog after Local Music", () => {
    const ids = sidebarNavItems.map((item) => item.id);
    expect(ids).toEqual([
      "home",
      "search",
      "library",
      "local",
      "changelog",
      "settings",
    ]);
    expect(ids.indexOf("changelog")).toBe(ids.indexOf("local") + 1);
    expect(ids.indexOf("settings")).toBe(ids.indexOf("changelog") + 1);
  });

  it("renders Settings/Changelog as buttons (no route) while Local Music keeps its route", () => {
    const local = sidebarNavItems.find((item) => item.id === "local");
    const settings = sidebarNavItems.find((item) => item.id === "settings");
    const changelog = sidebarNavItems.find((item) => item.id === "changelog");
    expect(local?.href).toBe("/local");
    expect(settings?.href).toBeUndefined();
    expect(changelog?.href).toBeUndefined();
  });
});
