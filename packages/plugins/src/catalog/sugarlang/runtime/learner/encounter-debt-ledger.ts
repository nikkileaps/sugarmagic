/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/encounter-debt-ledger.ts
 *
 * Purpose: Tracks per-item encounter debt for the outer-loop teacher.
 *   Introducing an item (lemma or function) creates a DEBT of TARGET_DEBT_ENCOUNTERS
 *   diverse re-encounters. Diversity is keyed by (npcDefinitionId, sceneId, dayIndex);
 *   when dayIndex is null (authored content never advances the day), diversity degrades
 *   gracefully to npcDefinitionId x sceneId only.
 *
 * Exports:
 *   - TARGET_DEBT_ENCOUNTERS
 *   - ENCOUNTER_DEBT_DB_NAME_PREFIX
 *   - EncounterEntry
 *   - DebtRecord
 *   - DebtStatus
 *   - EncounterDebtLedger
 *   - MemoryEncounterDebtLedger
 *   - IndexedDBEncounterDebtLedger
 *   - createEncounterDebtLedger
 *   - countDiverseEncounters
 *
 * Relationships:
 *   - DB name starts with CARD_STORE_DB_NAME_PREFIX so the learner-data reset
 *     enforcer (reset-learner-data.ts) auto-clears it.
 *   - Added to the closeables list in runtime-services.ts so resets do not hit
 *     the blocked-connection timeout (card-store.ts onversionchange precedent).
 *   - Consumed by the observe middleware (debt creation + paydown signals) and the
 *     context middleware (board assembly for the outer-loop scheduler).
 *
 * Implements: Plan 087 story 087.2
 *
 * Status: active
 */

import { CARD_STORE_DB_NAME_PREFIX } from "./card-store";

export const TARGET_DEBT_ENCOUNTERS = 10;

/**
 * All encounter-debt database names start with this prefix so the shared
 * learner-data reset enforcer deletes them.
 */
export const ENCOUNTER_DEBT_DB_NAME_PREFIX = `${CARD_STORE_DB_NAME_PREFIX}:debt:`;

const DEBT_STORE_NAME = "debt-records";

/** One recorded encounter in the diversity ledger. */
export interface EncounterEntry {
  npcDefinitionId: string | null;
  sceneId: string | null;
  /** null = authored content has not advanced the day; degrades diversity to npc x scene. */
  dayIndex: number | null;
}

/** Per-item debt record persisted in IDB. */
export interface DebtRecord {
  itemId: string;
  itemKind: "lemma" | "function";
  createdDayIndex: number | null;
  encounters: EncounterEntry[];
  targetEncounters: number;
}

/**
 * Reduced debt state surfaced to the scheduler board.
 * Only unpaid debts appear in the board's activeDebts map.
 */
export interface DebtStatus {
  diverseEncounterCount: number;
  targetEncounters: number;
}

/**
 * Count distinct diversity slots in an encounter list.
 * Two entries share a slot iff (npc, scene, day) are all equal
 * (with null === null for the day-axis-degraded case).
 */
export function countDiverseEncounters(encounters: EncounterEntry[]): number {
  const seen = new Set<string>();
  for (const e of encounters) {
    seen.add(`${e.npcDefinitionId ?? ""}\0${e.sceneId ?? ""}\0${e.dayIndex ?? ""}`);
  }
  return seen.size;
}

export interface EncounterDebtLedger {
  /**
   * Create a debt record for itemId. A no-op if the record already exists
   * (idempotent so callers do not need to guard).
   */
  createDebt(
    itemId: string,
    itemKind: "lemma" | "function",
    createdDayIndex: number | null
  ): Promise<void>;

  /**
   * Record one diverse encounter toward itemId's debt paydown.
   * A no-op if no debt exists for itemId (paydown without debt is safe to call).
   */
  recordEncounter(itemId: string, encounter: EncounterEntry): Promise<void>;

  /** Returns undefined if no debt record exists for itemId. */
  getDebt(itemId: string): Promise<DebtRecord | undefined>;

  /** All debt records ordered by itemId. */
  listDebts(): Promise<DebtRecord[]>;

  /**
   * Returns a map of itemId -> DebtStatus for all unpaid debts
   * (diverseEncounterCount < targetEncounters).
   */
  getActiveDebts(): Promise<Map<string, DebtStatus>>;

  close?: () => Promise<void>;
}

// ---------- In-memory implementation (used in tests and SSR) ----------

export class MemoryEncounterDebtLedger implements EncounterDebtLedger {
  private readonly records = new Map<string, DebtRecord>();

  async createDebt(
    itemId: string,
    itemKind: "lemma" | "function",
    createdDayIndex: number | null
  ): Promise<void> {
    if (this.records.has(itemId)) return;
    this.records.set(itemId, {
      itemId,
      itemKind,
      createdDayIndex,
      encounters: [],
      targetEncounters: TARGET_DEBT_ENCOUNTERS
    });
  }

  async recordEncounter(itemId: string, encounter: EncounterEntry): Promise<void> {
    const record = this.records.get(itemId);
    if (!record) return;
    record.encounters.push({ ...encounter });
  }

  async getDebt(itemId: string): Promise<DebtRecord | undefined> {
    const r = this.records.get(itemId);
    return r ? cloneRecord(r) : undefined;
  }

  async listDebts(): Promise<DebtRecord[]> {
    return Array.from(this.records.values())
      .map(cloneRecord)
      .sort((a, b) => a.itemId.localeCompare(b.itemId));
  }

  async getActiveDebts(): Promise<Map<string, DebtStatus>> {
    const result = new Map<string, DebtStatus>();
    for (const record of this.records.values()) {
      const diverse = countDiverseEncounters(record.encounters);
      if (diverse < record.targetEncounters) {
        result.set(record.itemId, {
          diverseEncounterCount: diverse,
          targetEncounters: record.targetEncounters
        });
      }
    }
    return result;
  }
}

function cloneRecord(r: DebtRecord): DebtRecord {
  return { ...r, encounters: r.encounters.map((e) => ({ ...e })) };
}

// ---------- IndexedDB implementation ----------

export class IndexedDBEncounterDebtLedger implements EncounterDebtLedger {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName: string) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(DEBT_STORE_NAME)) {
          db.createObjectStore(DEBT_STORE_NAME, { keyPath: "itemId" });
        }
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to open encounter-debt IDB."));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (this.dbPromise === opened) {
            this.dbPromise = null;
          }
        };
        resolve(db);
      };
    });
    this.dbPromise = opened;
    return opened;
  }

  async createDebt(
    itemId: string,
    itemKind: "lemma" | "function",
    createdDayIndex: number | null
  ): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DEBT_STORE_NAME, "readwrite");
      const store = tx.objectStore(DEBT_STORE_NAME);
      const getReq = store.get(itemId);
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve();
          return;
        }
        const record: DebtRecord = {
          itemId,
          itemKind,
          createdDayIndex,
          encounters: [],
          targetEncounters: TARGET_DEBT_ENCOUNTERS
        };
        const putReq = store.add(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async recordEncounter(itemId: string, encounter: EncounterEntry): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DEBT_STORE_NAME, "readwrite");
      const store = tx.objectStore(DEBT_STORE_NAME);
      const getReq = store.get(itemId);
      getReq.onsuccess = () => {
        const record = getReq.result as DebtRecord | undefined;
        if (!record) {
          resolve();
          return;
        }
        record.encounters.push({ ...encounter });
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getDebt(itemId: string): Promise<DebtRecord | undefined> {
    const db = await this.openDb();
    return new Promise<DebtRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(DEBT_STORE_NAME, "readonly");
      const store = tx.objectStore(DEBT_STORE_NAME);
      const req = store.get(itemId);
      req.onsuccess = () => resolve(req.result as DebtRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async listDebts(): Promise<DebtRecord[]> {
    const db = await this.openDb();
    return new Promise<DebtRecord[]>((resolve, reject) => {
      const tx = db.transaction(DEBT_STORE_NAME, "readonly");
      const store = tx.objectStore(DEBT_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as DebtRecord[]).sort((a, b) => a.itemId.localeCompare(b.itemId))
        );
      req.onerror = () => reject(req.error);
    });
  }

  async getActiveDebts(): Promise<Map<string, DebtStatus>> {
    const all = await this.listDebts();
    const result = new Map<string, DebtStatus>();
    for (const record of all) {
      const diverse = countDiverseEncounters(record.encounters);
      if (diverse < record.targetEncounters) {
        result.set(record.itemId, {
          diverseEncounterCount: diverse,
          targetEncounters: record.targetEncounters
        });
      }
    }
    return result;
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }
}

/**
 * Creates the appropriate EncounterDebtLedger for the current environment.
 * Falls back to MemoryEncounterDebtLedger when IndexedDB is unavailable.
 */
export function createEncounterDebtLedger(learnerId: string): EncounterDebtLedger {
  if (typeof indexedDB === "undefined") {
    return new MemoryEncounterDebtLedger();
  }
  return new IndexedDBEncounterDebtLedger(`${ENCOUNTER_DEBT_DB_NAME_PREFIX}${learnerId}`);
}
