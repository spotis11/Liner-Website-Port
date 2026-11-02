import { describe, expect, it } from "vitest";
import {
  createMaintenanceStore,
  decideMaintenanceAction,
  readPersistedMaintenance,
} from "./maintenanceStore";
import type { MaintenanceStatus } from "../lib/maintenanceApi";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const on: MaintenanceStatus = {
  enabled: true,
  reasons: ["Sign-in is temporarily unavailable", "Music playback is temporarily disabled"],
  updatedAt: "2026-11-02T06:30:00.000Z",
};

const off: MaintenanceStatus = {
  enabled: false,
  reasons: [],
  updatedAt: "2026-11-02T07:00:00.000Z",
};

describe("decideMaintenanceAction", () => {
  it("raises the wall with reasons while maintenance is on", () => {
    const decision = decideMaintenanceAction(on);
    expect(decision.action).toBe("wall");
    if (decision.action === "wall") expect(decision.reasons).toEqual(on.reasons);
  });

  it("releases authoritatively when maintenance ends", () => {
    expect(decideMaintenanceAction(off)).toEqual({ action: "release" });
  });
});

describe("maintenanceStore persistence", () => {
  it("hydrates an active wall synchronously from storage", () => {
    const storage = memoryStorage();
    const store = createMaintenanceStore(storage);
    store.getState().setActive(on);
    // a brand-new store (a page reload) must start walled immediately
    const reloaded = createMaintenanceStore(storage);
    expect(reloaded.getState().active).toBe(true);
    expect(reloaded.getState().reasons).toEqual(on.reasons);
  });

  it("drops the wall after an authoritative release", () => {
    const storage = memoryStorage();
    const store = createMaintenanceStore(storage);
    store.getState().setActive(on);
    store.getState().clearActive();
    expect(readPersistedMaintenance(storage).active).toBe(false);
    expect(createMaintenanceStore(storage).getState().active).toBe(false);
  });

  it("ignores corrupt persisted records", () => {
    const storage = memoryStorage();
    storage.setItem("liner_web_maintenance_v1", "{not json");
    expect(readPersistedMaintenance(storage)).toEqual({ active: false, reasons: [] });
    storage.setItem("liner_web_maintenance_v1", JSON.stringify({ enabled: "yes" }));
    expect(readPersistedMaintenance(storage).active).toBe(false);
  });

  it("never persists without storage (private mode)", () => {
    const store = createMaintenanceStore(null);
    store.getState().setActive(on);
    expect(store.getState().active).toBe(true);
  });
});
