/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/variant-cache.ts
 *
 * Purpose: Caches baked line variant artifacts by lang, band, content hash, and prompt version.
 *
 * Exports:
 *   - VariantCacheKey
 *   - VariantCacheEntry
 *   - VariantCacheEntryMeta
 *   - SugarlangVariantCache
 *   - MemoryVariantCache
 *   - IndexedDBVariantCache
 *   - createVariantCacheStorageKey
 *
 * Relationships:
 *   - Depends on baked-variant contracts.
 *   - Is consumed by generate-variant and the authoring compile scheduler.
 *
 * Implements: Epic 086 Story 086.3 -- bake-time variant generation
 *
 * Status: active
 */

import type { CEFRBand } from "../contracts/learner-profile";
import type { BakedLineVariant } from "../contracts/baked-variant";

export interface VariantCacheKey {
  lang: string;
  band: CEFRBand;
  /** hash of authored text + intent JSON */
  contentHash: string;
  variantPromptVersion: string;
}

export interface VariantCacheEntry {
  key: VariantCacheKey;
  variant: BakedLineVariant;
}

export interface VariantCacheEntryMeta extends VariantCacheKey {
  nodeId: string;
  dialogueDefinitionId: string;
  estimatedBytes: number;
  accessOrdinal: number;
}

interface VariantCacheRecord {
  entry: VariantCacheEntry;
  estimatedBytes: number;
  accessOrdinal: number;
}

export interface SugarlangVariantCache {
  get: (key: VariantCacheKey) => Promise<VariantCacheEntry | null>;
  set: (entry: VariantCacheEntry) => Promise<void>;
  has: (key: VariantCacheKey) => Promise<boolean>;
  invalidate: (contentHash?: string) => Promise<void>;
  listEntries: () => Promise<VariantCacheEntryMeta[]>;
}

export interface MemoryVariantCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export interface IndexedDBVariantCacheOptions extends MemoryVariantCacheOptions {
  workspaceId: string;
  indexedDbFactory?: IDBFactory | null;
  logger?: Pick<Console, "warn">;
}

const VARIANT_DB_NAME_PREFIX = "sugarlang-variant-cache";
const VARIANT_STORE_NAME = "sugarlang-variants";

function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function createVariantCacheStorageKey(key: VariantCacheKey): string {
  return `${key.variantPromptVersion}:${key.lang}:${key.band}:${key.contentHash}`;
}

export class MemoryVariantCache implements SugarlangVariantCache {
  private readonly records = new Map<string, VariantCacheRecord>();
  private accessCounter = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(options: MemoryVariantCacheOptions = {}) {
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

  async get(key: VariantCacheKey): Promise<VariantCacheEntry | null> {
    const storageKey = createVariantCacheStorageKey(key);
    const record = this.records.get(storageKey);
    if (!record) {
      return null;
    }

    this.touch(storageKey);
    return record.entry;
  }

  async set(entry: VariantCacheEntry): Promise<void> {
    const storageKey = createVariantCacheStorageKey(entry.key);
    this.records.set(storageKey, {
      entry,
      estimatedBytes: estimateBytes(entry),
      accessOrdinal: ++this.accessCounter
    });
    this.evictIfNeeded();
  }

  async has(key: VariantCacheKey): Promise<boolean> {
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

  async listEntries(): Promise<VariantCacheEntryMeta[]> {
    return [...this.records.values()]
      .map((record) => ({
        ...record.entry.key,
        nodeId: record.entry.variant.nodeId,
        dialogueDefinitionId: record.entry.variant.dialogueDefinitionId,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) =>
        createVariantCacheStorageKey(left).localeCompare(
          createVariantCacheStorageKey(right)
        )
      );
  }
}

interface IndexedDbVariantRecord extends VariantCacheEntryMeta {
  workspaceId: string;
  entry: VariantCacheEntry;
}

export class IndexedDBVariantCache implements SugarlangVariantCache {
  private readonly workspaceId: string;
  private readonly indexedDbFactory: IDBFactory | null;
  private readonly logger: Pick<Console, "warn">;
  private readonly fallback: MemoryVariantCache;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private accessCounter = 0;

  constructor(options: IndexedDBVariantCacheOptions) {
    this.workspaceId = options.workspaceId;
    this.indexedDbFactory =
      "indexedDbFactory" in options
        ? (options.indexedDbFactory ?? null)
        : (globalThis.indexedDB ?? null);
    this.logger = options.logger ?? console;
    this.fallback = new MemoryVariantCache(options);
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (!this.indexedDbFactory) {
      this.logger.warn(
        `[sugarlang] IndexedDB unavailable for workspace "${this.workspaceId}", falling back to in-memory variant cache.`
      );
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      const request = this.indexedDbFactory!.open(
        `${VARIANT_DB_NAME_PREFIX}:${this.workspaceId}`,
        1
      );
      request.onupgradeneeded = () => {
        request.result.createObjectStore(VARIANT_STORE_NAME, {
          keyPath: "storageKey"
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.logger.warn(
          `[sugarlang] IndexedDB open failed for workspace "${this.workspaceId}", falling back to in-memory variant cache.`
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
      const tx = db.transaction(VARIANT_STORE_NAME, mode);
      const store = tx.objectStore(VARIANT_STORE_NAME);
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
    Array<IndexedDbVariantRecord & { storageKey: string }>
  > {
    const records = await this.runTransaction<
      Array<IndexedDbVariantRecord & { storageKey: string }>
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

  async get(key: VariantCacheKey): Promise<VariantCacheEntry | null> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.get(key);
    }

    const storageKey = createVariantCacheStorageKey(key);
    const record = await this.runTransaction<
      IndexedDbVariantRecord & { storageKey: string }
    >("readonly", (store) => store.get(storageKey));
    if (!record) {
      return null;
    }

    record.accessOrdinal = ++this.accessCounter;
    await this.runTransaction("readwrite", (store) => store.put(record));
    return record.entry;
  }

  async set(entry: VariantCacheEntry): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.set(entry);
    }

    const storageKey = createVariantCacheStorageKey(entry.key);
    const record: IndexedDbVariantRecord & { storageKey: string } = {
      storageKey,
      ...entry.key,
      nodeId: entry.variant.nodeId,
      dialogueDefinitionId: entry.variant.dialogueDefinitionId,
      workspaceId: this.workspaceId,
      estimatedBytes: estimateBytes(entry),
      accessOrdinal: ++this.accessCounter,
      entry
    };
    await this.runTransaction("readwrite", (store) => store.put(record));
    await this.evictIfNeeded();
  }

  async has(key: VariantCacheKey): Promise<boolean> {
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

  async listEntries(): Promise<VariantCacheEntryMeta[]> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.listEntries();
    }

    return (await this.getAllRecords())
      .map((record) => ({
        ...record.entry.key,
        nodeId: record.entry.variant.nodeId,
        dialogueDefinitionId: record.entry.variant.dialogueDefinitionId,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) =>
        createVariantCacheStorageKey(left).localeCompare(
          createVariantCacheStorageKey(right)
        )
      );
  }
}
