/**
 * Tiny promise-wrapped IndexedDB helper.
 *
 * Why not a dependency: we only need three stores with TTLs. Pulling in
 * `idb` or `dexie` would inflate the MV3 bundle for what is ~80 lines of
 * code we control. The wrapper handles version upgrades by always passing
 * a schema; new stores are additive so old versions of the extension can
 * keep working after a downgrade.
 *
 * Falls back to an in-memory map when IndexedDB is unavailable (extension
 * service-worker contexts, locked-down profiles). Fallback is silently
 * non-persistent, which is acceptable for cache use.
 */

const DB_NAME = "nyrima";
const DB_VERSION = 1;

export const STORES = {
  FOLDER_SCAN: "folderScanCache",
  FILE_METADATA: "fileMetadataCache",
  SUBTITLE: "subtitleCache",
  THUMBNAIL: "thumbnailCache",
  MEDIA_SEGMENT: "mediaSegmentCache",
  WATCH_PROGRESS: "watchProgress",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

const ALL_STORES: StoreName[] = Object.values(STORES);

let dbPromise: Promise<IDBDatabase | null> | null = null;

// Memory fallback — keyed by `${storeName}:${key}` so all stores share a map.
const memFallback = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      // Extension service worker with no persistent storage permission can
      // hang on open(). Treat slow open as "not available" and fall back.
      timedOut = true;
      resolve(null);
    }, 1500);

    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ALL_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        if (timedOut) {
          try {
            req.result.close();
          } catch {
            // ignore
          }
          return;
        }
        resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        resolve(null);
      };
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
  return dbPromise;
}

function memKey(store: StoreName, key: string): string {
  return `${store}:${key}`;
}

export async function idbGet<T>(
  store: StoreName,
  key: string,
): Promise<T | undefined> {
  const db = await open();
  if (!db) {
    return memFallback.get(memKey(store, key)) as T | undefined;
  }
  return new Promise<T | undefined>((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function idbPut<T>(
  store: StoreName,
  key: string,
  value: T,
): Promise<void> {
  const db = await open();
  if (!db) {
    memFallback.set(memKey(store, key), value);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value as unknown as object, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbDelete(
  store: StoreName,
  key: string,
): Promise<void> {
  const db = await open();
  if (!db) {
    memFallback.delete(memKey(store, key));
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await open();
  if (!db) {
    for (const k of [...memFallback.keys()]) {
      if (k.startsWith(`${store}:`)) memFallback.delete(k);
    }
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** List all (key, value) pairs in a store. Used for LRU eviction. */
export async function idbEntries<T>(
  store: StoreName,
): Promise<Array<[string, T]>> {
  const db = await open();
  if (!db) {
    const out: Array<[string, T]> = [];
    const prefix = `${store}:`;
    for (const [k, v] of memFallback) {
      if (k.startsWith(prefix)) out.push([k.slice(prefix.length), v as T]);
    }
    return out;
  }
  return new Promise((resolve) => {
    try {
      const out: Array<[string, T]> = [];
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push([String(cursor.key), cursor.value as T]);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Total size (bytes) of all entries in a store. Approximate — relies on
 * value.size when present, otherwise blob.byteLength for media. Used by
 * the media segment cache LRU.
 */
export async function idbStoreByteSize(store: StoreName): Promise<number> {
  const entries = await idbEntries<{ size?: number; bytes?: Blob | ArrayBuffer }>(
    store,
  );
  let total = 0;
  for (const [, v] of entries) {
    if (typeof v?.size === "number") {
      total += v.size;
    } else if (v?.bytes instanceof Blob) {
      total += v.bytes.size;
    } else if (v?.bytes instanceof ArrayBuffer) {
      total += v.bytes.byteLength;
    }
  }
  return total;
}
