import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getCustomCoverUrl,
  setCustomCover,
  removeCustomCover,
} from "./customPlaylistCovers";

// ---------------------------------------------------------------------------
// Minimal IndexedDB fake — jsdom ships no IDB. Only what the module uses:
// open (with upgrade), one object store, get/put/delete via IDBRequest with
// async onsuccess. Structured-clone fidelity is approximated for Blob values.
// ---------------------------------------------------------------------------

type Rec = { id: string; blob: Blob; updatedAt: number };

class FakeRequest<T> {
  result: T;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(result: T) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }
}

class FakeStore {
  constructor(private db: FakeDb) {}
  get(key: string) {
    return new FakeRequest<Rec | undefined>(this.db.rows.get(key));
  }
  put(rec: Rec) {
    this.db.rows.set(rec.id, rec);
    return new FakeRequest<IDBValidKey>(rec.id);
  }
  delete(key: string) {
    this.db.rows.delete(key);
    return new FakeRequest<undefined>(undefined);
  }
}

class FakeTx {
  constructor(private db: FakeDb) {}
  objectStore() {
    return new FakeStore(this.db);
  }
}

class FakeDb {
  rows = new Map<string, Rec>();
  transaction() {
    return new FakeTx(this);
  }
}

let fakeDb: FakeDb;

beforeEach(() => {
  fakeDb = new FakeDb();
  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req = new FakeRequest<IDBDatabase>(fakeDb as unknown as IDBDatabase);
      // simulate upgrade running before success
      const original = req.onsuccess;
      req.onsuccess = () => original?.();
      return req;
    },
  };
  let counter = 0;
  (URL as unknown as Record<string, unknown>).createObjectURL = () =>
    `blob:mock-${++counter}`;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).indexedDB;
});

function jpegBlob(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {
    type: "image/jpeg",
  });
}

describe("customPlaylistCovers", () => {
  it("returns undefined when no custom cover is stored", async () => {
    await expect(getCustomCoverUrl("pl-1")).resolves.toBeUndefined();
  });

  it("stores, resolves and removes a custom cover", async () => {
    await setCustomCover("pl-1", jpegBlob());
    const url = await getCustomCoverUrl("pl-1");
    expect(url).toMatch(/^blob:mock-/);

    await removeCustomCover("pl-1");
    await expect(getCustomCoverUrl("pl-1")).resolves.toBeUndefined();
  });

  it("replaces an existing cover and keeps one url per playlist", async () => {
    await setCustomCover("pl-2", jpegBlob());
    const first = await getCustomCoverUrl("pl-2");
    await setCustomCover("pl-2", jpegBlob());
    const second = await getCustomCoverUrl("pl-2");
    expect(first).toMatch(/^blob:mock-/);
    expect(second).toMatch(/^blob:mock-/);
    expect(second).not.toBe(first);

    // other playlists stay independent
    await expect(getCustomCoverUrl("pl-3")).resolves.toBeUndefined();
  });
});
