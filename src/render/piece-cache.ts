/**
 * Things this build generates the same way every time (track piece geometry, tray pictures), saved in the browser
 * (IndexedDB) after they're first made, so later visits to the same build skip making them. One record per build
 * in each store; older builds' records are cleared. Every call tolerates storage being unavailable (private
 * windows, blocked site data): things are then just made as usual.
 */
const DB = "woodrail-cache";
export type CacheStore = "pieces" | "thumbnails";
const STORES: CacheStore[] = ["pieces", "thumbnails"];

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** What was saved in `store` for this build, or null. */
export async function loadCached<T>(store: CacheStore, build: string): Promise<T | null> {
  if (!build) return null;
  const db = await open();
  if (!db) return null;
  const value = await new Promise<T | null>((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(build);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return value;
}

/** Save this build's value in `store`, replacing any other build's. */
export async function saveCached(store: CacheStore, build: string, value: unknown): Promise<void> {
  if (!build) return;
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const s = tx.objectStore(store);
      s.clear();
      s.put(value, build);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

// The first version kept only pieces, under another name: clear it out.
try {
  indexedDB.deleteDatabase("woodrail-pieces");
} catch {
  // Nothing to clear.
}
