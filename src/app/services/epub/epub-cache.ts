/**
 * Tiny IndexedDB cache for raw EPUB bytes.
 *
 * Books live on Google Drive, so the first open pays a download. Caching the
 * raw archive bytes (keyed by Drive file id + md5) makes "continue reading"
 * instant on the next open and lets the reader work offline once a book has
 * been opened. We keep this in its own one-store database rather than the
 * shared `drive/idb.ts` schema so the reader can ship without touching that
 * module's version migrations.
 *
 * The cache is LRU-evicted by total byte budget; EPUBs are small (a few MB)
 * so a modest budget holds a healthy shelf.
 */

const DB_NAME = "nyrima-reader";
const DB_VERSION = 1;
const STORE = "epubBytes";
const BUDGET_BYTES = 300 * 1024 * 1024; // ~300 MB of cached books

interface CacheRecord {
  bytes: ArrayBuffer;
  size: number;
  lastUsed: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function getCachedEpub(key: string): Promise<ArrayBuffer | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as CacheRecord | undefined;
        if (!rec) {
          resolve(null);
          return;
        }
        // Touch lastUsed without blocking the read result.
        void touch(key, rec);
        resolve(rec.bytes);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCachedEpub(key: string, bytes: ArrayBuffer): Promise<void> {
  const db = await open();
  if (!db) return;
  const record: CacheRecord = { bytes, size: bytes.byteLength, lastUsed: Date.now() };
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  void evictIfNeeded();
}

async function touch(key: string, rec: CacheRecord): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...rec, lastUsed: Date.now() }, key);
  } catch {
    /* best effort */
  }
}

async function evictIfNeeded(): Promise<void> {
  const db = await open();
  if (!db) return;
  const entries = await allEntries(db);
  let total = entries.reduce((sum, [, rec]) => sum + rec.size, 0);
  if (total <= BUDGET_BYTES) return;
  entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed); // oldest first
  for (const [key, rec] of entries) {
    if (total <= BUDGET_BYTES) break;
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      total -= rec.size;
    } catch {
      /* skip */
    }
  }
}

function allEntries(db: IDBDatabase): Promise<Array<[string, CacheRecord]>> {
  return new Promise((resolve) => {
    const out: Array<[string, CacheRecord]> = [];
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push([String(cursor.key), cursor.value as CacheRecord]);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}
