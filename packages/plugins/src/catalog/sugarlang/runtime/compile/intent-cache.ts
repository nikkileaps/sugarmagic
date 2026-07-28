/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/intent-cache.ts
 *
 * Purpose: Caches extracted line-intent artifacts by content hash and prompt version.
 *
 * Exports:
 *   - LineIntentCacheKey (re-export)
 *   - LineIntentCacheEntry
 *   - SugarlangIntentCache
 *   - MemoryIntentCache
 *   - IndexedDBIntentCache
 *   - createIntentCacheStorageKey
 *
 * Relationships:
 *   - Depends on line-intent contracts.
 *   - Is consumed by extract-intent and the authoring compile scheduler.
 *
 * Implements: Epic 086 Story 086.1 -- line-intent model
 *
 * Status: active
 */

export type { LineIntentCacheKey } from "../contracts/line-intent";
import type { DialogueLineIntent } from "@sugarmagic/domain";
import type { LineIntentArtifact, LineIntentCacheKey } from "../contracts/line-intent";

/**
 * Shared content-hash builder for intent cache keys.
 * Both the bake pipeline (compile-scheduler.ts) and the runtime (scripted-middleware.ts)
 * must use this function so their keys match when a hand-authored intent field is present.
 * The variant key uses JSON.stringify({}) on both sides deliberately -- do NOT use this
 * function for variant cache keys.
 */
export function buildIntentContentHash(
  nodeId: string,
  text: string,
  intent?: DialogueLineIntent
): string {
  return [nodeId, text, JSON.stringify(intent ?? {})].join("|");
}

export interface LineIntentCacheEntry {
  key: LineIntentCacheKey;
  nodeId: string;
  dialogueDefinitionId: string;
  artifact: LineIntentArtifact;
}

export interface LineIntentCacheEntryMeta extends LineIntentCacheKey {
  nodeId: string;
  dialogueDefinitionId: string;
  estimatedBytes: number;
  accessOrdinal: number;
}

interface LineIntentCacheRecord {
  entry: LineIntentCacheEntry;
  estimatedBytes: number;
  accessOrdinal: number;
}

export interface SugarlangIntentCache {
  get: (key: LineIntentCacheKey) => Promise<LineIntentCacheEntry | null>;
  set: (entry: LineIntentCacheEntry) => Promise<void>;
  has: (key: LineIntentCacheKey) => Promise<boolean>;
  invalidate: (contentHash?: string) => Promise<void>;
  listEntries: () => Promise<LineIntentCacheEntryMeta[]>;
}

export interface MemoryIntentCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export interface IndexedDBIntentCacheOptions extends MemoryIntentCacheOptions {
  workspaceId: string;
  indexedDbFactory?: IDBFactory | null;
  logger?: Pick<Console, "warn">;
}

const INTENT_DB_NAME_PREFIX = "sugarlang-intent-cache";
const INTENT_STORE_NAME = "sugarlang-intents";

function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function createIntentCacheStorageKey(key: LineIntentCacheKey): string {
  return `${key.intentPromptVersion}:${key.contentHash}`;
}

export class MemoryIntentCache implements SugarlangIntentCache {
  private readonly records = new Map<string, LineIntentCacheRecord>();
  private accessCounter = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(options: MemoryIntentCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 400;
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  }

  private touch(storageKey: string): void {
    const record = this.records.get(storageKey);
    if (!record) {
      return;
    }
    record.accessOrdinal = ++this.accessCounter;
  }

  private totalBytes(): number {
    return [...this.records.values()].reduce(
      (sum, record) => sum + record.estimatedBytes,
      0
    );
  }

  private evictIfNeeded(): void {
    while (
      this.records.size > this.maxEntries ||
      this.totalBytes() > this.maxBytes
    ) {
      const oldest = [...this.records.entries()].sort(
        (left, right) => left[1].accessOrdinal - right[1].accessOrdinal
      )[0];
      if (!oldest) {
        return;
      }
      this.records.delete(oldest[0]);
    }
  }

  async get(key: LineIntentCacheKey): Promise<LineIntentCacheEntry | null> {
    const storageKey = createIntentCacheStorageKey(key);
    const record = this.records.get(storageKey);
    if (!record) {
      return null;
    }

    this.touch(storageKey);
    return record.entry;
  }

  async set(entry: LineIntentCacheEntry): Promise<void> {
    const storageKey = createIntentCacheStorageKey(entry.key);
    this.records.set(storageKey, {
      entry,
      estimatedBytes: estimateBytes(entry),
      accessOrdinal: ++this.accessCounter
    });
    this.evictIfNeeded();
  }

  async has(key: LineIntentCacheKey): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async invalidate(contentHash?: string): Promise<void> {
    if (!contentHash) {
      this.records.clear();
      return;
    }

    for (const [storageKey, record] of this.records.entries()) {
      if (record.entry.key.contentHash === contentHash) {
        this.records.delete(storageKey);
      }
    }
  }

  async listEntries(): Promise<LineIntentCacheEntryMeta[]> {
    return [...this.records.values()]
      .map((record) => ({
        ...record.entry.key,
        nodeId: record.entry.nodeId,
        dialogueDefinitionId: record.entry.dialogueDefinitionId,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) =>
        createIntentCacheStorageKey(left).localeCompare(
          createIntentCacheStorageKey(right)
        )
      );
  }
}

interface IndexedDbIntentRecord extends LineIntentCacheEntryMeta {
  workspaceId: string;
  entry: LineIntentCacheEntry;
}

export class IndexedDBIntentCache implements SugarlangIntentCache {
  private readonly workspaceId: string;
  private readonly indexedDbFactory: IDBFactory | null;
  private readonly logger: Pick<Console, "warn">;
  private readonly fallback: MemoryIntentCache;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private accessCounter = 0;

  constructor(options: IndexedDBIntentCacheOptions) {
    this.workspaceId = options.workspaceId;
    this.indexedDbFactory =
      "indexedDbFactory" in options
        ? (options.indexedDbFactory ?? null)
        : (globalThis.indexedDB ?? null);
    this.logger = options.logger ?? console;
    this.fallback = new MemoryIntentCache(options);
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (!this.indexedDbFactory) {
      this.logger.warn(
        `[sugarlang] IndexedDB unavailable for workspace "${this.workspaceId}", falling back to in-memory intent cache.`
      );
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      const request = this.indexedDbFactory!.open(
        `${INTENT_DB_NAME_PREFIX}:${this.workspaceId}`,
        1
      );
      request.onupgradeneeded = () => {
        request.result.createObjectStore(INTENT_STORE_NAME, {
          keyPath: "storageKey"
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.logger.warn(
          `[sugarlang] IndexedDB open failed for workspace "${this.workspaceId}", falling back to in-memory intent cache.`
        );
        resolve(null);
      };
    });

    return this.dbPromise;
  }

  private async runTransaction<T>(
    mode: IDBTransactionMode,
    runner: (store: IDBObjectStore) => IDBRequest | void
  ): Promise<T | null> {
    const db = await this.openDb();
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(INTENT_STORE_NAME, mode);
      const store = tx.objectStore(INTENT_STORE_NAME);
      const request = runner(store);

      tx.oncomplete = () => {
        if (request && "result" in request) {
          resolve((request as IDBRequest<T>).result ?? null);
        } else {
          resolve(null);
        }
      };
      tx.onerror = () => reject(tx.error);
      if (request) {
        request.onerror = () => reject(request.error);
      }
    });
  }

  private async getAllRecords(): Promise<
    Array<IndexedDbIntentRecord & { storageKey: string }>
  > {
    const records = await this.runTransaction<
      Array<IndexedDbIntentRecord & { storageKey: string }>
    >("readonly", (store) => store.getAll());
    return records ?? [];
  }

  private async evictIfNeeded(): Promise<void> {
    const records = await this.getAllRecords();
    const sorted = [...records].sort(
      (left, right) => left.accessOrdinal - right.accessOrdinal
    );
    let totalBytes = sorted.reduce(
      (sum, record) => sum + record.estimatedBytes,
      0
    );

    while (
      sorted.length > this.fallback.maxEntries ||
      totalBytes > this.fallback.maxBytes
    ) {
      const oldest = sorted.shift();
      if (!oldest) {
        return;
      }
      totalBytes -= oldest.estimatedBytes;
      await this.runTransaction("readwrite", (store) =>
        store.delete(oldest.storageKey)
      );
    }
  }

  async get(
    key: LineIntentCacheKey
  ): Promise<LineIntentCacheEntry | null> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.get(key);
    }

    const storageKey = createIntentCacheStorageKey(key);
    const record = await this.runTransaction<
      IndexedDbIntentRecord & { storageKey: string }
    >("readonly", (store) => store.get(storageKey));
    if (!record) {
      return null;
    }

    record.accessOrdinal = ++this.accessCounter;
    await this.runTransaction("readwrite", (store) => store.put(record));
    return record.entry;
  }

  async set(entry: LineIntentCacheEntry): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.set(entry);
    }

    const storageKey = createIntentCacheStorageKey(entry.key);
    const record: IndexedDbIntentRecord & { storageKey: string } = {
      storageKey,
      ...entry.key,
      nodeId: entry.nodeId,
      dialogueDefinitionId: entry.dialogueDefinitionId,
      workspaceId: this.workspaceId,
      estimatedBytes: estimateBytes(entry),
      accessOrdinal: ++this.accessCounter,
      entry
    };
    await this.runTransaction("readwrite", (store) => store.put(record));
    await this.evictIfNeeded();
  }

  async has(key: LineIntentCacheKey): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async invalidate(contentHash?: string): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.invalidate(contentHash);
    }

    if (!contentHash) {
      await this.runTransaction("readwrite", (store) => store.clear());
      return;
    }

    for (const record of await this.getAllRecords()) {
      if (record.entry.key.contentHash === contentHash) {
        await this.runTransaction("readwrite", (store) =>
          store.delete(record.storageKey)
        );
      }
    }
  }

  async listEntries(): Promise<LineIntentCacheEntryMeta[]> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.listEntries();
    }

    return (await this.getAllRecords())
      .map((record) => ({
        ...record.entry.key,
        nodeId: record.entry.nodeId,
        dialogueDefinitionId: record.entry.dialogueDefinitionId,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) =>
        createIntentCacheStorageKey(left).localeCompare(
          createIntentCacheStorageKey(right)
        )
      );
  }
}
