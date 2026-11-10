import { describe, it, expect } from "vitest";
import { sidebarNavItems } from "./navigation";

describe("sidebarNavItems", () => {
  it("keeps Settings and Changelog after Library", () => {
    const ids = sidebarNavItems.map((item) => item.id);
    expect(ids).toEqual([
      "home",
      "search",
      "library",
      "changelog",
      "settings",
    ]);
    expect(ids.indexOf("changelog")).toBe(ids.indexOf("library") + 1);
    expect(ids.indexOf("settings")).toBe(ids.indexOf("changelog") + 1);
  });

  it("does not bring back the removed fork tabs", () => {
    const ids = sidebarNavItems.map((item) => item.id);
    expect(ids).not.toContain("downloads");
    expect(ids).not.toContain("local");
  });

  it("renders Settings/Changelog as buttons (no route) while Library keeps its route", () => {
    const library = sidebarNavItems.find((item) => item.id === "library");
    const settings = sidebarNavItems.find((item) => item.id === "settings");
    const changelog = sidebarNavItems.find((item) => item.id === "changelog");
    expect(library?.href).toBe("/library");
    expect(settings?.href).toBeUndefined();
    expect(changelog?.href).toBeUndefined();
  });
});
