import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createLiquidGlassStore,
  useLiquidGlassStore,
  LIQUID_GLASS_STORAGE_KEY,
} from "./liquidGlassStore";

function freshStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: () => null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => map.set(k, v),
  } as Storage;
}

describe("liquidGlassStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLiquidGlassStore.getState().setEnabled(false);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to disabled", () => {
    const store = createLiquidGlassStore(freshStorage());
    expect(store.getState().enabled).toBe(false);
  });

  it("round-trips enablement through persistence", () => {
    const storage = freshStorage();
    const store = createLiquidGlassStore(storage);
    store.getState().setEnabled(true);
    expect(storage.getItem(LIQUID_GLASS_STORAGE_KEY)).toContain('"enabled":true');
    const reloaded = createLiquidGlassStore(storage);
    expect(reloaded.getState().enabled).toBe(true);
  });

  it("keeps the singleton store in sync with its own writes", () => {
    const storage = freshStorage();
    window.localStorage.setItem(LIQUID_GLASS_STORAGE_KEY, '{"enabled":true}');
    const reloaded = createLiquidGlassStore(window.localStorage);
    expect(reloaded.getState().enabled).toBe(true);
  });

  it("tolerates corrupt persisted records", () => {
    const storage = freshStorage();
    storage.setItem(LIQUID_GLASS_STORAGE_KEY, "{not json");
    const store = createLiquidGlassStore(storage);
    expect(store.getState().enabled).toBe(false);
    // A subsequent write repairs the record.
    store.getState().setEnabled(true);
    expect(
      JSON.parse(storage.getItem(LIQUID_GLASS_STORAGE_KEY) ?? "{}").enabled,
    ).toBe(true);
  });

  it("tolerates records with a non-boolean enabled field", () => {
    const storage = freshStorage();
    storage.setItem(LIQUID_GLASS_STORAGE_KEY, '{"enabled":"yes"}');
    const store = createLiquidGlassStore(storage);
    expect(store.getState().enabled).toBe(false);
  });

  it("survives storage outages (throws on write)", () => {
    const broken = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const store = createLiquidGlassStore(broken);
    expect(() => store.getState().setEnabled(true)).not.toThrow();
    expect(store.getState().enabled).toBe(true);
  });

  it("uses its own storage key — never the legacy appearance record", () => {
    const storage = freshStorage();
    storage.setItem("liner_web_appearance_v1", '{"liquidGlass":true}');
    const store = createLiquidGlassStore(storage);
    expect(store.getState().enabled).toBe(false);
  });
});
