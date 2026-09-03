/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/cache-memory.ts
 *
 * Purpose: Provides the in-memory reference implementation of the scene lexicon cache.
 *
 * Exports:
 *   - MemoryCompileCacheOptions
 *   - MemoryCompileCache
 *
 * Relationships:
 *   - Implements SugarlangCompileCache.
 *   - Serves as the fallback cache when IndexedDB is unavailable.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { SceneVocabularyModel } from "../types";
import {
  BaseSugarlangCompileCache,
  createCompileCacheKey,
  type CacheEntryMeta
} from "./sugarlang-compile-cache";

interface MemoryCacheRecord {
  lexicon: SceneVocabularyModel;
  estimatedBytes: number;
  accessOrdinal: number;
}

export interface MemoryCompileCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export class MemoryCompileCache extends BaseSugarlangCompileCache {
  private readonly records = new Map<string, MemoryCacheRecord>();
  private accessCounter = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(options: MemoryCompileCacheOptions = {}) {
    super();
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  }

  private touch(key: string): void {
    const record = this.records.get(key);
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

  override async get(
    regionId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ): Promise<SceneVocabularyModel | null> {
    const key = createCompileCacheKey(regionId, contentHash, profile);
    const record = this.records.get(key);
    if (!record) {
      return null;
    }

    this.touch(key);
    return record.lexicon;
  }

  override async set(lexicon: SceneVocabularyModel): Promise<void> {
    const key = createCompileCacheKey(
      lexicon.regionId,
      lexicon.contentHash,
      lexicon.profile
    );
    this.records.set(key, {
      lexicon,
      estimatedBytes: estimateBytes(lexicon),
      accessOrdinal: ++this.accessCounter
    });
    this.evictIfNeeded();
  }

  override async invalidate(regionId?: string): Promise<void> {
    if (!regionId) {
      this.records.clear();
      return;
    }

    for (const [key, record] of this.records.entries()) {
      if (record.lexicon.regionId === regionId) {
        this.records.delete(key);
      }
    }
  }

  override async listEntries(): Promise<CacheEntryMeta[]> {
    return [...this.records.entries()]
      .map(([cacheKey, record]) => ({
        cacheKey,
        regionId: record.lexicon.regionId,
        contentHash: record.lexicon.contentHash,
        profile: record.lexicon.profile,
        estimatedBytes: record.estimatedBytes,
        accessOrdinal: record.accessOrdinal
      }))
      .sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));
  }
}
