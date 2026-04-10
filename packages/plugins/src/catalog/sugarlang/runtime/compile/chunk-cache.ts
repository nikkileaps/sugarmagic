/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/chunk-cache.ts
 *
 * Purpose: Caches extracted scene chunks by content hash and emits drift telemetry on replacement.
 *
 * Exports:
 *   - Chunk cache key/entry/meta types
 *   - createChunkCacheStorageKey
 *   - SugarlangChunkCache
 *   - MemoryChunkCache
 *   - IndexedDBChunkCache
 *
 * Relationships:
 *   - Depends on lexical chunk contracts and telemetry.
 *   - Is consumed by the chunk extractor scheduler and publish pipeline.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness
 *
 * Status: active
 */

import type { LexicalChunk } from "../types";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";

export interface ChunkCacheKey {
  contentHash: string;
  lang: string;
  extractorPromptVersion: string;
}

export interface ChunkCacheEntry {
  key: ChunkCacheKey;
  sceneId: string;
  chunks: LexicalChunk[];
  extractedAtMs: number;
  extractedByModel: string;
}

export interface ChunkCacheEntryMeta extends ChunkCacheKey {
  sceneId: string;
  estimatedBytes: number;
  accessOrdinal: number;
}

interface ChunkCacheRecord {
  entry: ChunkCacheEntry;
  estimatedBytes: number;
  accessOrdinal: number;
}

export interface SugarlangChunkCache {
  get: (key: ChunkCacheKey) => Promise<ChunkCacheEntry | null>;
  set: (entry: ChunkCacheEntry) => Promise<void>;
  has: (key: ChunkCacheKey) => Promise<boolean>;
  invalidate: (contentHash?: string) => Promise<void>;
  listEntries: () => Promise<ChunkCacheEntryMeta[]>;
}

export interface MemoryChunkCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  telemetry?: TelemetrySink;
}

export interface IndexedDBChunkCacheOptions extends MemoryChunkCacheOptions {
  workspaceId: string;
  indexedDbFactory?: IDBFactory | null;
  logger?: Pick<Console, "warn">;
}

const CHUNK_DB_NAME_PREFIX = "sugarlang-chunk-cache";
const CHUNK_STORE_NAME = "sugarlang-chunks";

function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function createChunkCacheStorageKey(key: ChunkCacheKey): string {
  return `${key.lang}:${key.extractorPromptVersion}:${key.contentHash}`;
}

function chunkSignature(chunks: LexicalChunk[]): string[] {
  return [...chunks]
    .map((chunk) => `${chunk.chunkId}:${chunk.normalizedForm}:${chunk.cefrBand}`)
    .sort((left, right) => left.localeCompare(right));
}

async function emitDriftIfNeeded(
  telemetry: TelemetrySink,
  previous: ChunkCacheEntry | null,
  next: ChunkCacheEntry
): Promise<void> {
  if (!previous) {
    return;
  }

  const previousSignature = chunkSignature(previous.chunks);
  const nextSignature = chunkSignature(next.chunks);
  if (
    previousSignature.length === nextSignature.length &&
    previousSignature.every((entry, index) => entry === nextSignature[index])
  ) {
    return;
  }

  const changedChunks = Array.from(
    new Set(
      [...previousSignature, ...nextSignature]
        .filter((entry) => !previousSignature.includes(entry) || !nextSignature.includes(entry))
        .map((entry) => entry.split(":")[1] ?? entry)
    )
  ).sort((left, right) => left.localeCompare(right));

  await emitTelemetry(
    telemetry,
    createTelemetryEvent("chunk.extraction-drift-detected", {
      timestamp: next.extractedAtMs,
      sceneId: next.sceneId,
      contentHash: next.key.contentHash,
      previousChunkCount: previous.chunks.length,
      newChunkCount: next.chunks.length,
      previousExtractorModel: previous.extractedByModel,
      newExtractorModel: next.extractedByModel,
      changedChunks
    })
  );
}

export class MemoryChunkCache implements SugarlangChunkCache {
  private readonly records = new Map<string, ChunkCacheRecord>();
  private readonly telemetry: TelemetrySink;
  private accessCounter = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(options: MemoryChunkCacheOptions = {}) {
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
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

  private findByContentHash(
    contentHash: string,
    lang: string
  ): ChunkCacheEntry | null {
    for (const record of this.records.values()) {
      if (
        record.entry.key.contentHash === contentHash &&
        record.entry.key.lang === lang
      ) {
        return record.entry;
      }
    }
    return null;
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

  async get(key: ChunkCacheKey): Promise<ChunkCacheEntry | null> {
    const storageKey = createChunkCacheStorageKey(key);
    const record = this.records.get(storageKey);
    if (!record) {
      return null;
    }

    this.touch(storageKey);
    return record.entry;
  }

  async set(entry: ChunkCacheEntry): Promise<void> {
    const previous = this.findByContentHash(entry.key.contentHash, entry.key.lang);
    await emitDriftIfNeeded(this.telemetry, previous, entry);

    const storageKey = createChunkCacheStorageKey(entry.key);
    this.records.set(storageKey, {
      entry,
      estimatedBytes: estimateBytes(entry),
      accessOrdinal: ++this.accessCounter
    });
    this.evictIfNeeded();
  }

  async has(key: ChunkCacheKey): Promise<boolean> {
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

  async listEntries(): Promise<ChunkCacheEntryMeta[]> {
    return [...this.records.values()]
      .map((record) => ({
        ...record.entry.key,
        sceneId: record.entry.sceneId,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) =>
        createChunkCacheStorageKey(left).localeCompare(createChunkCacheStorageKey(right))
      );
  }
}

interface IndexedDbChunkRecord extends ChunkCacheEntryMeta {
  workspaceId: string;
  entry: ChunkCacheEntry;
}

export class IndexedDBChunkCache implements SugarlangChunkCache {
  private readonly workspaceId: string;
  private readonly indexedDbFactory: IDBFactory | null;
  private readonly logger: Pick<Console, "warn">;
  private readonly fallback: MemoryChunkCache;
  private readonly telemetry: TelemetrySink;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private accessCounter = 0;

  constructor(options: IndexedDBChunkCacheOptions) {
    this.workspaceId = options.workspaceId;
    this.indexedDbFactory =
      "indexedDbFactory" in options
        ? (options.indexedDbFactory ?? null)
        : (globalThis.indexedDB ?? null);
    this.logger = options.logger ?? console;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
    this.fallback = new MemoryChunkCache(options);
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (!this.indexedDbFactory) {
      this.logger.warn(
        `[sugarlang] IndexedDB unavailable for workspace "${this.workspaceId}", falling back to in-memory chunk cache.`
      );
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      const request = this.indexedDbFactory!.open(
        `${CHUNK_DB_NAME_PREFIX}:${this.workspaceId}`,
        1
      );
      request.onupgradeneeded = () => {
        request.result.createObjectStore(CHUNK_STORE_NAME, { keyPath: "storageKey" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.logger.warn(
          `[sugarlang] IndexedDB open failed for workspace "${this.workspaceId}", falling back to in-memory chunk cache.`
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
      const tx = db.transaction(CHUNK_STORE_NAME, mode);
      const store = tx.objectStore(CHUNK_STORE_NAME);
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

  private async getAllRecords(): Promise<Array<IndexedDbChunkRecord & { storageKey: string }>> {
    const records = await this.runTransaction<Array<IndexedDbChunkRecord & { storageKey: string }>>(
      "readonly",
      (store) => store.getAll()
    );
    return records ?? [];
  }

  private async findByContentHash(
    contentHash: string,
    lang: string
  ): Promise<ChunkCacheEntry | null> {
    const records = await this.getAllRecords();
    for (const record of records) {
      if (record.entry.key.contentHash === contentHash && record.entry.key.lang === lang) {
        return record.entry;
      }
    }
    return null;
  }

  private async evictIfNeeded(): Promise<void> {
    const records = await this.getAllRecords();
    const sorted = [...records].sort(
      (left, right) => left.accessOrdinal - right.accessOrdinal
    );
    let totalBytes = sorted.reduce((sum, record) => sum + record.estimatedBytes, 0);

    while (
      sorted.length > this.fallback.maxEntries ||
      totalBytes > this.fallback.maxBytes
    ) {
      const oldest = sorted.shift();
      if (!oldest) {
        return;
      }
      totalBytes -= oldest.estimatedBytes;
      await this.runTransaction("readwrite", (store) => store.delete(oldest.storageKey));
    }
  }

  async get(key: ChunkCacheKey): Promise<ChunkCacheEntry | null> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.get(key);
    }

    const storageKey = createChunkCacheStorageKey(key);
    const record = await this.runTransaction<IndexedDbChunkRecord & { storageKey: string }>(
      "readonly",
      (store) => store.get(storageKey)
    );
    if (!record) {
      return null;
    }

    record.accessOrdinal = ++this.accessCounter;
    await this.runTransaction("readwrite", (store) => store.put(record));
    return record.entry;
  }

  async set(entry: ChunkCacheEntry): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.set(entry);
    }

    const previous = await this.findByContentHash(entry.key.contentHash, entry.key.lang);
    await emitDriftIfNeeded(this.telemetry, previous, entry);

    const storageKey = createChunkCacheStorageKey(entry.key);
    const record: IndexedDbChunkRecord & { storageKey: string } = {
      storageKey,
      ...entry.key,
      sceneId: entry.sceneId,
      workspaceId: this.workspaceId,
      estimatedBytes: estimateBytes(entry),
      accessOrdinal: ++this.accessCounter,
      entry
    };
    await this.runTransaction("readwrite", (store) => store.put(record));
    await this.evictIfNeeded();
  }

  async has(key: ChunkCacheKey): Promise<boolean> {
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

  async listEntries(): Promise<ChunkCacheEntryMeta[]> {
    const db = await this.openDb();
    if (!db) {
      return this.fallback.listEntries();
    }

    return (await this.getAllRecords())
      .map((record) => ({
        ...record.entry.key,
        sceneId: record.entry.sceneId,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) =>
        createChunkCacheStorageKey(left).localeCompare(createChunkCacheStorageKey(right))
      );
  }
}
