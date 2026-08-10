/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/teach-record-store.ts
 *
 * Purpose: Persists per-function teach-records beside the FSRS card store.
 *   A teach-record is written exactly once per competencyId (the no-rewrite guard).
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

import {
  assertAccountScopedLearnerId,
  CARD_STORE_DB_NAME_PREFIX
} from "./card-store";
import { gameScopedStorageName } from "@sugarmagic/runtime-core";

/**
 * All teach-record database names start with this prefix so the shared
 * learner-data reset enforcer deletes them. The prefix starts with
 * CARD_STORE_DB_NAME_PREFIX to stay under the reset enforcer's guard.
 */
export const TEACH_RECORD_DB_NAME_PREFIX = `${CARD_STORE_DB_NAME_PREFIX}:teach:`;

const TEACH_RECORD_STORE_NAME = "teach-records";

export interface TeachRecord {
  competencyId: string;
  taughtAtMs: number;
  realizingChunkId: string;
}

export interface TeachRecordStore {
  has: (competencyId: string) => Promise<boolean>;
  write: (record: TeachRecord) => Promise<void>;
  list: () => Promise<TeachRecord[]>;
  close?: () => Promise<void>;
}

// ---------- In-memory implementation (used in tests and SSR) ----------

export class MemoryTeachRecordStore implements TeachRecordStore {
  private readonly records = new Map<string, TeachRecord>();

  async has(competencyId: string): Promise<boolean> {
    return this.records.has(competencyId);
  }

  async write(record: TeachRecord): Promise<void> {
    if (!this.records.has(record.competencyId)) {
      this.records.set(record.competencyId, { ...record });
    }
  }

  async list(): Promise<TeachRecord[]> {
    return Array.from(this.records.values()).sort((a, b) =>
      a.competencyId.localeCompare(b.competencyId)
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
          db.createObjectStore(TEACH_RECORD_STORE_NAME, { keyPath: "competencyId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  async has(competencyId: string): Promise<boolean> {
    const db = await this.openDb();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(TEACH_RECORD_STORE_NAME, "readonly");
      const store = tx.objectStore(TEACH_RECORD_STORE_NAME);
      const req = store.count(competencyId);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(req.error);
    });
  }

  async write(record: TeachRecord): Promise<void> {
    const alreadyWritten = await this.has(record.competencyId);
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
  // Checked BEFORE the memory fallback: an unscoped id is a caller bug in
  // every environment, and letting it through in one of them is how it
  // survives to production. See `assertAccountScopedLearnerId`.
  assertAccountScopedLearnerId(learnerId, "createTeachRecordStore");
  if (typeof indexedDB === "undefined") {
    return new MemoryTeachRecordStore();
  }
  return new IndexedDBTeachRecordStore(gameScopedStorageName(TEACH_RECORD_DB_NAME_PREFIX, learnerId));
}
