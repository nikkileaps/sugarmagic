/**
 * packages/runtime-core/src/account-data/backing.ts
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
 *   - AccountDataBacking
 *   - createMemoryAccountBacking
 *   - createIndexedDBAccountBacking
 *   - ACCOUNT_DATA_DB_PREFIX
 *
 * Implements: Plan 092 story 092.6.2
 *
 * Status: active
 */

import type { AccountStoreKey, StoredAccountRecord } from "./index";

/** Every account-data database starts with this, so a wipe can find them. */
export const ACCOUNT_DATA_DB_PREFIX = "sugarmagic-account-data";

const OBJECT_STORE = "records";
const PENDING_INDEX = "pending";
const DB_VERSION = 1;

export interface AccountDataBacking {
  read(key: string): Promise<StoredAccountRecord | undefined>;
  write(records: ReadonlyArray<StoredAccountRecord>): Promise<void>;
  readPage(
    afterKey: string,
    limit: number
  ): Promise<{ records: StoredAccountRecord[]; nextCursor: string | null }>;
  readPending(limit: number): Promise<StoredAccountRecord[]>;
  removeAll(): Promise<void>;
  close?(): Promise<void>;
}

export function createMemoryAccountBacking(): AccountDataBacking {
  const rows = new Map<string, StoredAccountRecord>();
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
      const records = page.map((k) => ({ ...(rows.get(k) as StoredAccountRecord) }));
      const nextCursor = keys.length > limit ? (page[page.length - 1] ?? null) : null;
      return { records, nextCursor };
    },
    async readPending(limit) {
      const out: StoredAccountRecord[] = [];
      for (const key of sortedKeys()) {
        const row = rows.get(key) as StoredAccountRecord;
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

export function createIndexedDBAccountBacking(
  storeKey: AccountStoreKey
): AccountDataBacking {
  const factory = globalThis.indexedDB;
  if (!factory) {
    throw new Error("[account-data] IndexedDB is unavailable.");
  }
  // The account is IN THE DATABASE NAME, not just in the rows. Two accounts on
  // one browser therefore cannot see each other's data even through a bug in
  // this file -- the wrong-key class of mistake that Plan 092.6.1 fixed cannot
  // reach across a database boundary.
  const dbName =
    `${ACCOUNT_DATA_DB_PREFIX}:${storeKey.pluginId}` +
    `:${storeKey.storeId}:${storeKey.userId}`;

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
        reject(request.error ?? new Error(`[account-data] cannot open ${dbName}`));
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
        req.onsuccess = () => resolve(req.result as StoredAccountRecord | undefined);
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
        const records: StoredAccountRecord[] = [];
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
          records.push(cursor.value as StoredAccountRecord);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },

    async readPending(limit) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const records: StoredAccountRecord[] = [];
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
          records.push(cursor.value as StoredAccountRecord);
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
