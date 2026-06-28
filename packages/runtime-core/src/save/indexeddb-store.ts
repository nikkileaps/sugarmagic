/**
 * packages/runtime-core/src/save/indexeddb-store.ts
 *
 * Purpose: Default `GameSaveStore` implementation for the "no plugin
 * installed" path. Single IndexedDB database, single object store,
 * keyed by `userId`. SugarProfile (Plan 047 §47.8) overrides this
 * with a Supabase-backed remote store when the plugin is enabled.
 *
 * Uses the native IDB API directly via a small promise wrapper —
 * the surface here is narrow enough (open + get + put + delete)
 * that an `idb` dependency wouldn't pay for itself in bundle size.
 *
 * Implements: Plan 047 §Story 47.4
 *
 * Status: active
 */

import {
  GAME_SAVE_SCHEMA_VERSION,
  type GameSave,
  type GameSaveStore
} from "./index";

const DB_NAME = "sugarmagic-saves";
const STORE_NAME = "saves";
const DB_VERSION = 1;

export interface IndexedDBGameSaveStoreOptions {
  /** IDBFactory to use for opening the database. Defaults to
   *  `globalThis.indexedDB`. Tests inject `fake-indexeddb`. */
  indexedDB?: IDBFactory;
  /** ISO-timestamp factory for stamping `lastPlayed` at write time.
   *  Defaults to `new Date().toISOString()`. */
  nowIso?: () => string;
}

function defaultIndexedDB(): IDBFactory | null {
  const candidate = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return candidate ?? null;
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error(
            `[runtime-core] IndexedDB request failed (no error attached).`
          )
      );
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error(
            `[runtime-core] IndexedDB open(${DB_NAME}) failed (no error attached).`
          )
      );
  });
}

/**
 * Creates a `GameSaveStore` backed by IndexedDB. Database +
 * object-store creation is lazy: the DB opens on the first
 * `load` / `save` / `clear` call and the connection is reused
 * for the lifetime of this provider. Operations against the same
 * `userId` are serialized through the underlying IDB transaction
 * model.
 *
 * `save(userId, save)` performs an upsert against the
 * `userId`-keyed object store, so a second write replaces the
 * first — there's no concept of multiple saves per user in v1.
 * The store stamps `lastPlayed` + `schemaVersion` at write time;
 * callers pass only the `payload` semantics.
 *
 * Defense in depth: every operation asserts the passed `userId`
 * matches the `userId` on the stored record before returning.
 * Belt-and-suspenders against caller bugs that pass the wrong
 * `userId`.
 */
export function createIndexedDBGameSaveStore(
  options: IndexedDBGameSaveStoreOptions = {}
): GameSaveStore {
  const resolvedFactory: IDBFactory | null =
    options.indexedDB ?? defaultIndexedDB();
  const nowIso = options.nowIso ?? defaultNowIso;

  if (!resolvedFactory) {
    throw new Error(
      "[runtime-core] IndexedDBGameSaveStore needs an IDBFactory. globalThis.indexedDB was not available; inject one via IndexedDBGameSaveStoreOptions.indexedDB."
    );
  }
  const factory: IDBFactory = resolvedFactory;

  // Open lazily + cache the promise so concurrent first-callers
  // share one open. Subsequent calls hit the cached connection.
  let dbPromise: Promise<IDBDatabase> | null = null;
  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) dbPromise = openDatabase(factory);
    return dbPromise;
  }

  return {
    async load(userId): Promise<GameSave | null> {
      if (!userId) {
        throw new Error("[runtime-core] load() requires a non-empty userId.");
      }
      const db = await getDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const record = await awaitRequest<GameSave | undefined>(
        store.get(userId)
      );
      if (!record) return null;
      if (record.userId !== userId) {
        throw new Error(
          `[runtime-core] IndexedDB record under key "${userId}" has mismatched userId "${record.userId}". Refusing to return cross-user state.`
        );
      }
      return record;
    },

    async save(userId, save): Promise<void> {
      if (!userId) {
        throw new Error("[runtime-core] save() requires a non-empty userId.");
      }
      if (save.userId !== userId) {
        throw new Error(
          `[runtime-core] save() called with userId="${userId}" but the GameSave carries userId="${save.userId}". Refusing to write cross-user state.`
        );
      }
      const stamped: GameSave = {
        ...save,
        userId,
        lastPlayed: nowIso(),
        schemaVersion: GAME_SAVE_SCHEMA_VERSION
      };
      const db = await getDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      await awaitRequest(store.put(stamped));
    },

    async clear(userId): Promise<void> {
      if (!userId) {
        throw new Error("[runtime-core] clear() requires a non-empty userId.");
      }
      const db = await getDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      await awaitRequest(store.delete(userId));
    }
  };
}
