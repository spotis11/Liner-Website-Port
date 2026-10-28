import { describe, expect, it, beforeEach, vi } from "vitest";
import type { BanInfo } from "../lib/moderationApi";
import {
  createBanStore,
  decideBanGateAction,
  readPersistedBan,
} from "./banStore";

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

const wall: BanInfo = {
  username: "spammer",
  type: "normal",
  reason: "spam",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  avatarUrl: "https://cdn.example.com/spammer.png",
};

describe("banStore — the wall survives reloads", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("hydrates a persisted ban synchronously so the wall is up on first paint", () => {
    storage.setItem(
      "liner_web_ban_v1",
      JSON.stringify({
        username: "spammer",
        type: "normal",
        reason: "spam",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: null,
        avatarUrl: "https://cdn.example.com/spammer.png",
      }),
    );
    const useStore = createBanStore(storage);
    expect(useStore.getState().ban).not.toBeNull();
    expect(useStore.getState().ban?.username).toBe("spammer");
    expect(useStore.getState().ban?.avatarUrl).toBe("https://cdn.example.com/spammer.png");
  });

  it("setBan writes the record and clearBan removes it", () => {
    const useStore = createBanStore(storage);
    expect(useStore.getState().ban).toBeNull();

    useStore.getState().setBan(wall);
    expect(useStore.getState().ban?.username).toBe("spammer");
    expect(storage.getItem("liner_web_ban_v1")).toContain("spammer");

    useStore.getState().clearBan();
    expect(useStore.getState().ban).toBeNull();
    expect(storage.getItem("liner_web_ban_v1")).toBeNull();
  });

  it("drops expired persisted bans (self-healing like the server prune)", () => {
    storage.setItem(
      "liner_web_ban_v1",
      JSON.stringify({
        username: "spammer",
        type: "ip",
        reason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const useStore = createBanStore(storage);
    expect(useStore.getState().ban).toBeNull();
    expect(storage.getItem("liner_web_ban_v1")).toBeNull();
  });

  it("ignores corrupt or malformed records", () => {
    storage.setItem("liner_web_ban_v1", "{not json");
    expect(readPersistedBan(storage)).toBeNull();

    storage.setItem("liner_web_ban_v1", JSON.stringify({ username: "x" }));
    expect(readPersistedBan(storage)).toBeNull();

    storage.setItem(
      "liner_web_ban_v1",
      JSON.stringify({ username: "ok-name", type: "ban", createdAt: "nope" }),
    );
    expect(readPersistedBan(storage)).toBeNull();
  });

  it("survives a storage outage without crashing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
      clear: () => {},
      key: () => null,
      get length() {
        return 0;
      },
    } as Storage;
    const useStore = createBanStore(throwing);
    expect(useStore.getState().ban).toBeNull();
    expect(() => useStore.getState().setBan(wall)).not.toThrow();
    expect(useStore.getState().ban?.username).toBe("spammer");
  });
});

describe("decideBanGateAction — server answers decide wall vs release", () => {
  it("raises the wall when the probe says banned (keeps the remembered username)", () => {
    const decision = decideBanGateAction(
      { banned: true, type: "ip", reason: "abuse", expiresAt: null, username: null },
      "spammer",
    );
    expect(decision.action).toBe("wall");
    if (decision.action === "wall") {
      expect(decision.ban.username).toBe("spammer");
      expect(decision.ban.type).toBe("ip");
      expect(decision.ban.avatarUrl).toBeNull();
    }
  });

  it("carries the captured profile picture onto the wall", () => {
    const decision = decideBanGateAction(
      { banned: true, type: "normal", reason: null, expiresAt: null, username: "spammer" },
      "spammer",
      "https://cdn.example.com/spammer.png",
    );
    expect(decision.action).toBe("wall");
    if (decision.action === "wall") {
      expect(decision.ban.avatarUrl).toBe("https://cdn.example.com/spammer.png");
    }
  });

  it("releases the wall only on an authoritative not-banned answer", () => {
    const decision = decideBanGateAction({ banned: false }, "spammer");
    expect(decision).toEqual({ action: "release" });
  });
});

describe("banGate probe contract (fetch level)", () => {
  it("re-probes with the remembered username while signed out", async () => {
    const { checkBan } = await import("../lib/moderationApi");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ banned: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await checkBan("spammer", null);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("/api/moderation/check");
    expect(JSON.parse(String(init.body))).toEqual({ username: "spammer" });
    vi.unstubAllGlobals();
  });
});
