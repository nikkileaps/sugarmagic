/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/cache-indexeddb.ts
 *
 * Purpose: Persists compiled scene lexicons in IndexedDB with memory fallback.
 *
 * Exports:
 *   - IndexedDBCompileCacheOptions
 *   - IndexedDBCompileCache
 *
 * Relationships:
 *   - Implements SugarlangCompileCache.
 *   - Falls back to MemoryCompileCache when IndexedDB is unavailable.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { CompiledSceneLexicon } from "../types";
import {
  BaseSugarlangCompileCache,
  createCompileCacheKey,
  type CacheEntryMeta
} from "./sugarlang-compile-cache";
import { MemoryCompileCache, type MemoryCompileCacheOptions } from "./cache-memory";

const DB_NAME_PREFIX = "sugarlang-compile-cache";
const STORE_NAME = "scene-lexicons";

interface IndexedDbCacheRecord extends CacheEntryMeta {
  workspaceId: string;
  lexicon: CompiledSceneLexicon;
}

export interface IndexedDBCompileCacheOptions extends MemoryCompileCacheOptions {
  workspaceId: string;
  indexedDbFactory?: IDBFactory | null;
  logger?: Pick<Console, "warn">;
}

function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export class IndexedDBCompileCache extends BaseSugarlangCompileCache {
  private readonly workspaceId: string;
  private readonly indexedDbFactory: IDBFactory | null;
  private readonly logger: Pick<Console, "warn">;
  private readonly fallback: MemoryCompileCache;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private accessCounter = 0;

  constructor(options: IndexedDBCompileCacheOptions) {
    super();
    this.workspaceId = options.workspaceId;
    this.indexedDbFactory =
      "indexedDbFactory" in options
        ? (options.indexedDbFactory ?? null)
        : (globalThis.indexedDB ?? null);
    this.logger = options.logger ?? console;
    this.fallback = new MemoryCompileCache(options);
    this.maxEntries = this.fallback.maxEntries;
    this.maxBytes = this.fallback.maxBytes;
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (!this.indexedDbFactory) {
      this.logger.warn(
        `[sugarlang] IndexedDB unavailable for workspace "${this.workspaceId}", falling back to in-memory compile cache.`
      );
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      const request = this.indexedDbFactory!.open(
        `${DB_NAME_PREFIX}:${this.workspaceId}`,
        1
      );
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.logger.warn(
          `[sugarlang] IndexedDB open failed for workspace "${this.workspaceId}", falling back to in-memory compile cache.`
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
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
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

  private async getAllRecords(): Promise<IndexedDbCacheRecord[]> {
    const records = await this.runTransaction<IndexedDbCacheRecord[]>(
      "readonly",
      (store) => store.getAll()
    );
    return records ?? [];
  }

  private async evictIfNeeded(maxBytes: number, maxEntries: number): Promise<void> {
    const records = await this.getAllRecords();
    const sorted = [...records].sort(
      (left, right) => left.accessOrdinal - right.accessOrdinal
    );
    let totalBytes = sorted.reduce((sum, record) => sum + record.estimatedBytes, 0);

    while (sorted.length > maxEntries || totalBytes > maxBytes) {
      const oldest = sorted.shift();
      if (!oldest) {
        return;
      }
      totalBytes -= oldest.estimatedBytes;
      await this.runTransaction("readwrite", (store) =>
        store.delete(oldest.cacheKey)
      );
    }
  }

  override async get(
    sceneId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ): Promise<CompiledSceneLexicon | null> {
    const cacheKey = createCompileCacheKey(sceneId, contentHash, profile);
    const db = await this.openDb();
    if (!db) {
      return this.fallback.get(sceneId, contentHash, profile);
    }

    const record = await this.runTransaction<IndexedDbCacheRecord>(
      "readonly",
      (store) => store.get(cacheKey)
    );
    if (!record) {
      return null;
    }

    record.accessOrdinal = ++this.accessCounter;
    await this.runTransaction("readwrite", (store) => store.put(record));
    return record.lexicon;
  }

  override async set(lexicon: CompiledSceneLexicon): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.set(lexicon);
    }

    const record: IndexedDbCacheRecord = {
      cacheKey: createCompileCacheKey(
        lexicon.sceneId,
        lexicon.contentHash,
        lexicon.profile
      ),
      workspaceId: this.workspaceId,
      sceneId: lexicon.sceneId,
      contentHash: lexicon.contentHash,
      profile: lexicon.profile,
      estimatedBytes: estimateBytes(lexicon),
      accessOrdinal: ++this.accessCounter,
      lexicon
    };
    await this.runTransaction("readwrite", (store) => store.put(record));
    await this.evictIfNeeded(this.maxBytes, this.maxEntries);
  }

  override async has(
    sceneId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ): Promise<boolean> {
    return (await this.get(sceneId, contentHash, profile)) !== null;
  }

  override async invalidate(sceneId?: string): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.invalidate(sceneId);
    }

    if (!sceneId) {
      await this.runTransaction("readwrite", (store) => store.clear());
      return;
    }

    for (const record of await this.getAllRecords()) {
      if (record.sceneId === sceneId) {
        await this.runTransaction("readwrite", (store) =>
          store.delete(record.cacheKey)
        );
      }
    }
  }

  override async listEntries(): Promise<CacheEntryMeta[]> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.listEntries();
    }

    return (await this.getAllRecords())
      .map((record) => ({
        cacheKey: record.cacheKey,
        sceneId: record.sceneId,
        contentHash: record.contentHash,
        profile: record.profile,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));
  }
}
