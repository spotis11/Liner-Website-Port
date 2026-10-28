// Liner web port: local music library persistence.
//
// Recreated from the shipped bundle (the untracked source was lost to an
// environment reset — see worklog Task 26). IndexedDB holds the user's own
// audio blobs so local tracks play fully offline: three stores —
//   files   { id, name, blob, size, type, lastModified, addedAt, folderId, path, meta }
//   folders { id, name, addedAt, handle? }   (handle = FileSystemDirectoryHandle)
//   covers  { id, blob }                      (embedded artwork, same id as file)
//
// resolvePlaybackStream serves localFileId tracks straight from here without
// touching the network.

export interface LocalTrackMeta {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  trackNumber?: number;
  durationMs?: number;
}

export interface LocalFileRecord {
  id: string;
  name: string;
  blob: Blob;
  size: number;
  type: string;
  lastModified: number;
  addedAt: number;
  folderId?: string;
  path?: string;
  meta: LocalTrackMeta;
}

export interface LocalFolderRecord {
  id: string;
  name: string;
  addedAt: number;
  handle?: FileSystemDirectoryHandle;
}

export interface LocalCoverRecord {
  id: string;
  blob: Blob;
}

const DB_NAME = "liner_local_music_v1";
const DB_VERSION = 1;

type StoreName = "files" | "folders" | "covers";
type RunCallback<T> = (store: IDBObjectStore) => IDBRequest<T> | void;

class LocalMusicDb {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly supported = typeof indexedDB !== "undefined";

  private open(): Promise<IDBDatabase> {
    if (!this.supported)
      return Promise.reject(new Error("IndexedDB is not available"));
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        this.dbPromise = null;
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("files"))
          db.createObjectStore("files", { keyPath: "id" });
        if (!db.objectStoreNames.contains("folders"))
          db.createObjectStore("folders", { keyPath: "id" });
        if (!db.objectStoreNames.contains("covers"))
          db.createObjectStore("covers", { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          this.dbPromise = null;
        };
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // already closed
          }
          this.dbPromise = null;
        };
        db.onerror = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });
    return this.dbPromise;
  }

  private async run<T>(
    store: StoreName,
    mode: IDBTransactionMode,
    callback: RunCallback<T>,
  ): Promise<T | null> {
    try {
      const db = await this.open();
      return await new Promise<T | null>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result: T | null = null;
        const request = callback(objectStore);
        if (request) {
          request.onsuccess = () => {
            result = request.result;
          };
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error("local music transaction aborted"),
          );
        transaction.onerror = () =>
          reject(
            transaction.error ?? new Error("local music transaction failed"),
          );
      });
    } catch {
      // library ops must never crash playback; callers handle empty results
      return null;
    }
  }

  async putFile(record: LocalFileRecord): Promise<void> {
    await this.run("files", "readwrite", (store) => store.put(record));
  }

  async getAllFiles(): Promise<LocalFileRecord[]> {
    return (
      (await this.run<LocalFileRecord[]>("files", "readonly", (store) =>
        store.getAll(),
      )) ?? []
    );
  }

  async getFile(id: string): Promise<LocalFileRecord | null> {
    return (
      (await this.run<LocalFileRecord>("files", "readonly", (store) =>
        store.get(id),
      )) ?? null
    );
  }

  async deleteFile(id: string): Promise<void> {
    await this.run("files", "readwrite", (store) => {
      store.delete(id);
    });
    await this.run("covers", "readwrite", (store) => {
      store.delete(id);
    });
  }

  async clearFiles(): Promise<void> {
    return this.run("files", "readwrite", (store) => {
      store.clear();
    }).then(() => undefined);
  }

  async putFolder(record: LocalFolderRecord): Promise<void> {
    await this.run("folders", "readwrite", (store) => store.put(record));
  }

  async getAllFolders(): Promise<LocalFolderRecord[]> {
    return (
      (await this.run<LocalFolderRecord[]>("folders", "readonly", (store) =>
        store.getAll(),
      )) ?? []
    );
  }

  async deleteFolder(id: string): Promise<void> {
    return this.run("folders", "readwrite", (store) => {
      store.delete(id);
    }).then(() => undefined);
  }

  async putCover(id: string, blob: Blob): Promise<void> {
    await this.run("covers", "readwrite", (store) => store.put({ id, blob }));
  }

  async getCover(id: string): Promise<LocalCoverRecord | null> {
    return (
      (await this.run<LocalCoverRecord>("covers", "readonly", (store) =>
        store.get(id),
      )) ?? null
    );
  }
}

export const localMusicDb = new LocalMusicDb();
