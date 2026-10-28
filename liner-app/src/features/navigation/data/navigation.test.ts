import { describe, it, expect } from "vitest";
import { sidebarNavItems } from "./navigation";

describe("sidebarNavItems", () => {
  it("keeps Settings in the nav list right after Local Music", () => {
    const ids = sidebarNavItems.map((item) => item.id);
    expect(ids).toEqual(["home", "search", "library", "local", "settings"]);
    expect(ids.indexOf("settings")).toBe(ids.indexOf("local") + 1);
  });

  it("renders Settings as a button (no route) while Local Music keeps its route", () => {
    const local = sidebarNavItems.find((item) => item.id === "local");
    const settings = sidebarNavItems.find((item) => item.id === "settings");
    expect(local?.href).toBe("/local");
    expect(settings?.href).toBeUndefined();
  });
});
