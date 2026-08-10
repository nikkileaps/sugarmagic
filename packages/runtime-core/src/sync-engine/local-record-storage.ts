/**
 * packages/runtime-core/src/sync-engine/adapter.ts
 *
 * Purpose: Where an account store actually keeps its rows. One interface, an
 *   IndexedDB implementation and a memory one, so the store above says nothing
 *   about storage.
 *
 * WHY `pending` IS A NUMBER
 *   IndexedDB cannot index a boolean, and the sync loop's only question is
 *   "what still needs pushing?". An index on 0/1 answers it without walking
 *   every record -- which matters, because a word history reaches thousands of
 *   rows while the pending set stays tiny.
 *
 * Exports:
 *   - LocalRecordStorageAdapter
 *   - createMemoryRecordStorage
 *   - createIndexedDBRecordStorage
 *   - RECORD_STORE_DB_PREFIX
 *
 * Implements: Plan 092 story 092.6.2
 *
 * Status: active
 */

import { gameScopedStorageName } from "../storage-names";
import type { RecordStoreKey, StoredRecord } from "./index";

/** Distinguishes record databases from a game's other storage. */
export const RECORD_STORE_DB_SEGMENT = "records";

const OBJECT_STORE = "records";
const PENDING_INDEX = "pending";
const DB_VERSION = 1;

export interface LocalRecordStorageAdapter {
  read(key: string): Promise<StoredRecord | undefined>;
  write(records: ReadonlyArray<StoredRecord>): Promise<void>;
  readPage(
    afterKey: string,
    limit: number
  ): Promise<{ records: StoredRecord[]; nextCursor: string | null }>;
  readPending(limit: number): Promise<StoredRecord[]>;
  removeAll(): Promise<void>;
  close?(): Promise<void>;
}

export function createMemoryRecordStorage(): LocalRecordStorageAdapter {
  const rows = new Map<string, StoredRecord>();
  const sortedKeys = () => Array.from(rows.keys()).sort();

  return {
    async read(key) {
      const row = rows.get(key);
      return row ? { ...row } : undefined;
    },
    async write(records) {
      for (const record of records) rows.set(record.key, { ...record });
    },
    async readPage(afterKey, limit) {
      const keys = sortedKeys().filter((k) => k > afterKey);
      const page = keys.slice(0, limit);
      const records = page.map((k) => ({ ...(rows.get(k) as StoredRecord) }));
      const nextCursor = keys.length > limit ? (page[page.length - 1] ?? null) : null;
      return { records, nextCursor };
    },
    async readPending(limit) {
      const out: StoredRecord[] = [];
      for (const key of sortedKeys()) {
        const row = rows.get(key) as StoredRecord;
        if (row.pending === 1) out.push({ ...row });
        if (out.length >= limit) break;
      }
      return out;
    },
    async removeAll() {
      rows.clear();
    }
  };
}

export function createIndexedDBRecordStorage(
  storeKey: RecordStoreKey
): LocalRecordStorageAdapter {
  const factory = globalThis.indexedDB;
  if (!factory) {
    throw new Error("[sync-engine] IndexedDB is unavailable.");
  }
  // The game AND the account are in the database name, not just in the rows.
  // Two accounts on one browser therefore cannot see each other's data even
  // through a bug in this file, and two games previewed on the same origin
  // cannot see each other's at all -- the wrong-key class of mistake cannot
  // reach across a database boundary.
  const dbName = gameScopedStorageName(
    RECORD_STORE_DB_SEGMENT,
    storeKey.pluginId,
    storeKey.storeId,
    storeKey.userId
  );

  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(OBJECT_STORE)) {
          const store = db.createObjectStore(OBJECT_STORE, { keyPath: "key" });
          store.createIndex(PENDING_INDEX, "pending", { unique: false });
        }
      };
      request.onerror = () =>
        reject(request.error ?? new Error(`[sync-engine] cannot open ${dbName}`));
      request.onsuccess = () => {
        const db = request.result;
        // Release the connection when another tab upgrades, so a wipe is not
        // blocked forever by this one. Same guard the card store uses.
        db.onversionchange = () => {
          db.close();
          if (dbPromise === opened) dbPromise = null;
        };
        resolve(db);
      };
    });
    dbPromise = opened;
    return opened;
  }

  function awaitTx(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    async read(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const req = db
          .transaction(OBJECT_STORE, "readonly")
          .objectStore(OBJECT_STORE)
          .get(key);
        req.onsuccess = () => resolve(req.result as StoredRecord | undefined);
        req.onerror = () => reject(req.error);
      });
    },

    async write(records) {
      if (records.length === 0) return;
      const db = await openDb();
      // One transaction for the batch: a partial write of a sync batch would
      // leave records marked pushed that were not.
      const tx = db.transaction(OBJECT_STORE, "readwrite");
      const store = tx.objectStore(OBJECT_STORE);
      for (const record of records) store.put(record);
      await awaitTx(tx);
    },

    async readPage(afterKey, limit) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const records: StoredRecord[] = [];
        const range = IDBKeyRange.lowerBound(afterKey, true);
        const req = db
          .transaction(OBJECT_STORE, "readonly")
          .objectStore(OBJECT_STORE)
          .openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || records.length >= limit) {
            resolve({
              records,
              // A cursor still standing means there is more after this page.
              nextCursor: cursor ? (records[records.length - 1]?.key ?? null) : null
            });
            return;
          }
          records.push(cursor.value as StoredRecord);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },

    async readPending(limit) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const records: StoredRecord[] = [];
        const req = db
          .transaction(OBJECT_STORE, "readonly")
          .objectStore(OBJECT_STORE)
          .index(PENDING_INDEX)
          .openCursor(IDBKeyRange.only(1));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || records.length >= limit) {
            resolve(records);
            return;
          }
          records.push(cursor.value as StoredRecord);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },

    async removeAll() {
      const db = await openDb();
      const tx = db.transaction(OBJECT_STORE, "readwrite");
      tx.objectStore(OBJECT_STORE).clear();
      await awaitTx(tx);
    },

    async close() {
      if (!dbPromise) return;
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    }
  };
}
