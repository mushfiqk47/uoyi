// Media bytes (clips, imports, renders) live in IndexedDB; everything else is small JSON in
// localStorage and synchronized to workspace files on desktop/local server.
const DB_NAME = "clipkit-media";
const STORE = "blobs";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openFresh(version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const next = db.version + 1;
        db.close();
        resolve(openFresh(next));
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function open(): Promise<IDBDatabase> {
  // Retry once on transient connection errors, never destructively delete user media automatically.
  dbPromise ??= openFresh().catch(async (firstErr) => {
    dbPromise = null;
    await new Promise((r) => setTimeout(r, 120));
    try {
      dbPromise = openFresh();
      return await dbPromise;
    } catch {
      dbPromise = null;
      throw firstErr instanceof Error
        ? firstErr
        : new Error("Could not open local media database. Close duplicate tabs or restart the app.");
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T | undefined;
        const transaction = db.transaction(STORE, mode);
        const req = run(transaction.objectStore(STORE));
        req.onsuccess = () => {
          result = req.result;
          // A read is final once its request succeeds. A write is not: the transaction can
          // still abort (quota, disk, page close) after this event, so writes must wait for
          // `complete` or a failed save would be reported as success.
          if (mode === "readonly") resolve(result as T);
        };
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => resolve(result as T);
        transaction.onerror = () => reject(transaction.error ?? req.error);
        transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));
      }),
  );
}

export const putBlob = (key: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, key)).then(() => undefined);
export const getBlob = (key: string) => tx<Blob | undefined>("readonly", (s) => s.get(key));
export const deleteBlob = (key: string) => {
  forgetUrl(key); // don't leave an object URL pinning a blob that is being removed
  return tx("readwrite", (s) => s.delete(key)).then(() => undefined);
};
export const clearBlobs = () => tx("readwrite", (s) => s.clear()).then(() => undefined);

/** Removes recording chunk blobs left behind by a tab that closed mid-segment. Keys are
 *  `rec:<startedAt base36>:<uid>:<seq>`, so only keys older than `maxAgeMs` are touched;
 *  chunks from another tab that is still recording are recent and always kept. */
export async function deleteStaleRecordingChunks(maxAgeMs: number): Promise<number> {
  const db = await open();
  const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const cutoff = Date.now() - maxAgeMs;
  const stale = keys.filter((key): key is string => {
    if (typeof key !== "string" || !key.startsWith("rec:")) return false;
    const started = parseInt(key.slice(4).split(":")[0], 36);
    return Number.isFinite(started) && started < cutoff;
  });
  if (!stale.length) return 0;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const key of stale) store.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return stale.length;
}

const urls = new Map<string, Promise<string | null>>();
const pinCounts = new Map<string, number>();
const MAX_LIVE_URLS = 64;

function evictUnpinnedUrls(): void {
  if (urls.size <= MAX_LIVE_URLS) return;
  for (const key of Array.from(urls.keys())) {
    if (urls.size <= MAX_LIVE_URLS) break;
    if ((pinCounts.get(key) ?? 0) > 0) continue;
    forgetUrl(key);
  }
}

/** An object URL for a stored blob, cached per key with unpinned LRU eviction so active
 *  players/modals cannot have their URLs revoked while mounted. */
export function blobUrl(key: string): Promise<string | null> {
  let p = urls.get(key);
  if (!p) {
    p = getBlob(key).then((b) => (b ? URL.createObjectURL(b) : null));
    urls.set(key, p);
    evictUnpinnedUrls();
  } else {
    // Re-insert to mark the key as recently used (Map iterates in insertion order).
    urls.delete(key);
    urls.set(key, p);
  }
  return p;
}

/** Pins a blob URL against LRU eviction until the returned `release()` handle is called. */
export async function acquireBlobUrl(key: string): Promise<{ url: string | null; release: () => void }> {
  pinCounts.set(key, (pinCounts.get(key) ?? 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const next = (pinCounts.get(key) ?? 1) - 1;
    if (next <= 0) {
      pinCounts.delete(key);
      evictUnpinnedUrls();
    } else {
      pinCounts.set(key, next);
    }
  };
  try {
    const url = await blobUrl(key);
    if (!url) release();
    return { url, release };
  } catch (e) {
    release();
    throw e;
  }
}

export function forgetUrl(key: string): void {
  const p = urls.get(key);
  urls.delete(key);
  pinCounts.delete(key);
  p?.then((u) => u && URL.revokeObjectURL(u));
}
