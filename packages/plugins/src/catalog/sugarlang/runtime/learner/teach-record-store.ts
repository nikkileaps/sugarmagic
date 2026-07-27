/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/teach-record-store.ts
 *
 * Purpose: Persists per-function teach-records beside the FSRS card store.
 *   A teach-record is written exactly once per functionId (the no-rewrite guard).
 *   It is the data source for any future phrasebook/journal UI (deferred to epic 089).
 *
 * Exports:
 *   - TEACH_RECORD_DB_NAME_PREFIX
 *   - TeachRecord
 *   - TeachRecordStore
 *   - MemoryTeachRecordStore
 *   - IndexedDBTeachRecordStore
 *
 * Relationships:
 *   - DB name starts with CARD_STORE_DB_NAME_PREFIX so the learner-data reset
 *     enforcer (reset-learner-data.ts) deletes it automatically.
 *   - Consumed by the observe middleware (085.3/085.5) and the learner debug surface.
 *
 * Implements: Plan 085 story 085.5
 *
 * Status: active
 */

import { CARD_STORE_DB_NAME_PREFIX } from "./card-store";

/**
 * All teach-record database names start with this prefix so the shared
 * learner-data reset enforcer deletes them. The prefix starts with
 * CARD_STORE_DB_NAME_PREFIX to stay under the reset enforcer's guard.
 */
export const TEACH_RECORD_DB_NAME_PREFIX = `${CARD_STORE_DB_NAME_PREFIX}:teach:`;

const TEACH_RECORD_STORE_NAME = "teach-records";

export interface TeachRecord {
  functionId: string;
  taughtAtMs: number;
  realizingChunkId: string;
}

export interface TeachRecordStore {
  has: (functionId: string) => Promise<boolean>;
  write: (record: TeachRecord) => Promise<void>;
  list: () => Promise<TeachRecord[]>;
  close?: () => Promise<void>;
}

// ---------- In-memory implementation (used in tests and SSR) ----------

export class MemoryTeachRecordStore implements TeachRecordStore {
  private readonly records = new Map<string, TeachRecord>();

  async has(functionId: string): Promise<boolean> {
    return this.records.has(functionId);
  }

  async write(record: TeachRecord): Promise<void> {
    if (!this.records.has(record.functionId)) {
      this.records.set(record.functionId, { ...record });
    }
  }

  async list(): Promise<TeachRecord[]> {
    return Array.from(this.records.values()).sort((a, b) =>
      a.functionId.localeCompare(b.functionId)
    );
  }
}

// ---------- IndexedDB implementation ----------

export class IndexedDBTeachRecordStore implements TeachRecordStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName: string) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(TEACH_RECORD_STORE_NAME)) {
          db.createObjectStore(TEACH_RECORD_STORE_NAME, { keyPath: "functionId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  async has(functionId: string): Promise<boolean> {
    const db = await this.openDb();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(TEACH_RECORD_STORE_NAME, "readonly");
      const store = tx.objectStore(TEACH_RECORD_STORE_NAME);
      const req = store.count(functionId);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(req.error);
    });
  }

  async write(record: TeachRecord): Promise<void> {
    const alreadyWritten = await this.has(record.functionId);
    if (alreadyWritten) return;
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TEACH_RECORD_STORE_NAME, "readwrite");
      const store = tx.objectStore(TEACH_RECORD_STORE_NAME);
      const req = store.add({ ...record });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async list(): Promise<TeachRecord[]> {
    const db = await this.openDb();
    return new Promise<TeachRecord[]>((resolve, reject) => {
      const tx = db.transaction(TEACH_RECORD_STORE_NAME, "readonly");
      const store = tx.objectStore(TEACH_RECORD_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as TeachRecord[]);
      req.onerror = () => reject(req.error);
    });
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }
}

/**
 * Creates the appropriate TeachRecordStore for the current environment.
 * Falls back to MemoryTeachRecordStore if IndexedDB is unavailable.
 */
export function createTeachRecordStore(learnerId: string): TeachRecordStore {
  if (typeof indexedDB === "undefined") {
    return new MemoryTeachRecordStore();
  }
  return new IndexedDBTeachRecordStore(`${TEACH_RECORD_DB_NAME_PREFIX}${learnerId}`);
}
