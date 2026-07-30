/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-context-cache.ts
 *
 * Purpose: Caches scene-context models -- what a scene's authored content is
 *   ABOUT -- by content hash, so a build only pays the gateway for scenes whose
 *   content actually changed.
 *
 * KEYED ON SUPPORT LANGUAGE, NOT TARGET
 *   This is the one place NOT to copy `ChunkCacheKey`, which keys on `lang`
 *   (the target). Concepts are ENGLISH words -- `cheese`, not `queso` -- so the
 *   same scene built for Spanish and for Italian produces IDENTICAL concepts and
 *   must share one entry. Keying on the target language would re-extract and
 *   re-bill every scene once per target. Only resolution (090.2) is
 *   target-specific.
 *
 * PROMPT VERSION IS IN THE KEY, DELIBERATELY
 *   Concepts are pure model output with no author edit path, so invalidating
 *   them when the prompt changes loses nothing. That reasoning does NOT transfer
 *   to the variant cache, which is keyed the same way and thereby orphans
 *   hand-edited variants -- see docs/backlog/007. Do not generalize the pattern.
 *
 * Exports:
 *   - SceneContextCacheKey / Entry / EntryMeta
 *   - createSceneContextCacheStorageKey
 *   - SugarlangSceneContextCache
 *   - MemorySceneContextCache
 *   - IndexedDBSceneContextCache
 *
 * Relationships:
 *   - Stores SceneContextModel (contracts/scene-context) produced by
 *     SceneContextExtractor.
 *   - Written by the Studio build path only. The runtime receives models by
 *     seeding, never by extracting -- a player's machine must not do authoring
 *     work.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import type { SceneContextModel } from "../contracts/scene-context";

export interface SceneContextCacheKey {
  contentHash: string;
  /** The language concepts are written in. NOT the target language. */
  supportLanguage: string;
  promptVersion: string;
}

export interface SceneContextCacheEntry {
  key: SceneContextCacheKey;
  sceneId: string;
  model: SceneContextModel;
}

export interface SceneContextCacheEntryMeta extends SceneContextCacheKey {
  sceneId: string;
  conceptCount: number;
}

export function createSceneContextCacheStorageKey(
  key: SceneContextCacheKey
): string {
  return `${key.supportLanguage}:${key.promptVersion}:${key.contentHash}`;
}

export interface SugarlangSceneContextCache {
  get: (key: SceneContextCacheKey) => Promise<SceneContextCacheEntry | null>;
  set: (entry: SceneContextCacheEntry) => Promise<void>;
  has: (key: SceneContextCacheKey) => Promise<boolean>;
  invalidate: (contentHash?: string) => Promise<void>;
  listEntries: () => Promise<SceneContextCacheEntryMeta[]>;
}

function toMeta(entry: SceneContextCacheEntry): SceneContextCacheEntryMeta {
  return {
    ...entry.key,
    sceneId: entry.sceneId,
    conceptCount: entry.model.concepts.length
  };
}

export class MemorySceneContextCache implements SugarlangSceneContextCache {
  private readonly records = new Map<string, SceneContextCacheEntry>();

  async get(key: SceneContextCacheKey): Promise<SceneContextCacheEntry | null> {
    return this.records.get(createSceneContextCacheStorageKey(key)) ?? null;
  }

  async set(entry: SceneContextCacheEntry): Promise<void> {
    this.records.set(createSceneContextCacheStorageKey(entry.key), entry);
  }

  async has(key: SceneContextCacheKey): Promise<boolean> {
    return this.records.has(createSceneContextCacheStorageKey(key));
  }

  async invalidate(contentHash?: string): Promise<void> {
    if (contentHash === undefined) {
      this.records.clear();
      return;
    }
    for (const [storageKey, entry] of [...this.records.entries()]) {
      if (entry.key.contentHash === contentHash) {
        this.records.delete(storageKey);
      }
    }
  }

  async listEntries(): Promise<SceneContextCacheEntryMeta[]> {
    return [...this.records.values()]
      .map(toMeta)
      .sort((left, right) =>
        createSceneContextCacheStorageKey(left).localeCompare(
          createSceneContextCacheStorageKey(right)
        )
      );
  }
}

const SCENE_CONTEXT_DB_NAME_PREFIX = "sugarlang-scene-context-cache";
const SCENE_CONTEXT_STORE_NAME = "scene-context";

export interface IndexedDBSceneContextCacheOptions {
  workspaceId: string;
  indexedDbFactory?: IDBFactory | null;
  logger?: Pick<Console, "warn">;
}

interface IndexedDbSceneContextRecord extends SceneContextCacheEntryMeta {
  storageKey: string;
  workspaceId: string;
  entry: SceneContextCacheEntry;
}

/**
 * Falls back to an in-memory cache whenever IndexedDB is unavailable or errors.
 * A build with no persistence is slower, not broken.
 */
export class IndexedDBSceneContextCache implements SugarlangSceneContextCache {
  private readonly workspaceId: string;
  private readonly indexedDbFactory: IDBFactory | null;
  private readonly logger: Pick<Console, "warn">;
  private readonly fallback = new MemorySceneContextCache();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(options: IndexedDBSceneContextCacheOptions) {
    this.workspaceId = options.workspaceId;
    this.indexedDbFactory =
      "indexedDbFactory" in options
        ? (options.indexedDbFactory ?? null)
        : (globalThis.indexedDB ?? null);
    this.logger = options.logger ?? console;
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    if (!this.indexedDbFactory) {
      this.logger.warn(
        `[sugarlang] IndexedDB unavailable for workspace "${this.workspaceId}", falling back to in-memory scene-context cache.`
      );
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      const request = this.indexedDbFactory!.open(
        `${SCENE_CONTEXT_DB_NAME_PREFIX}:${this.workspaceId}`,
        1
      );
      request.onupgradeneeded = () => {
        request.result.createObjectStore(SCENE_CONTEXT_STORE_NAME, {
          keyPath: "storageKey"
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.logger.warn(
          `[sugarlang] IndexedDB open failed for workspace "${this.workspaceId}", falling back to in-memory scene-context cache.`
        );
        resolve(null);
      };
    });

    return this.dbPromise;
  }

  private async runTransaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T | null> {
    const db = await this.openDb();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(SCENE_CONTEXT_STORE_NAME, mode);
        const request = run(tx.objectStore(SCENE_CONTEXT_STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async get(key: SceneContextCacheKey): Promise<SceneContextCacheEntry | null> {
    const storageKey = createSceneContextCacheStorageKey(key);
    const record = await this.runTransaction<IndexedDbSceneContextRecord>(
      "readonly",
      (store) => store.get(storageKey) as IDBRequest<IndexedDbSceneContextRecord>
    );
    if (record?.entry) return record.entry;
    return this.fallback.get(key);
  }

  async set(entry: SceneContextCacheEntry): Promise<void> {
    await this.fallback.set(entry);
    const record: IndexedDbSceneContextRecord = {
      ...toMeta(entry),
      storageKey: createSceneContextCacheStorageKey(entry.key),
      workspaceId: this.workspaceId,
      entry
    };
    await this.runTransaction("readwrite", (store) => store.put(record));
  }

  async has(key: SceneContextCacheKey): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async invalidate(contentHash?: string): Promise<void> {
    await this.fallback.invalidate(contentHash);
    if (contentHash === undefined) {
      await this.runTransaction("readwrite", (store) => store.clear());
      return;
    }
    const records = await this.runTransaction<IndexedDbSceneContextRecord[]>(
      "readonly",
      (store) => store.getAll() as IDBRequest<IndexedDbSceneContextRecord[]>
    );
    for (const record of records ?? []) {
      if (record.contentHash === contentHash) {
        await this.runTransaction("readwrite", (store) =>
          store.delete(record.storageKey)
        );
      }
    }
  }

  async listEntries(): Promise<SceneContextCacheEntryMeta[]> {
    const records = await this.runTransaction<IndexedDbSceneContextRecord[]>(
      "readonly",
      (store) => store.getAll() as IDBRequest<IndexedDbSceneContextRecord[]>
    );
    if (!records) return this.fallback.listEntries();
    return records
      .map(
        (record): SceneContextCacheEntryMeta => ({
          contentHash: record.contentHash,
          supportLanguage: record.supportLanguage,
          promptVersion: record.promptVersion,
          sceneId: record.sceneId,
          conceptCount: record.conceptCount
        })
      )
      .sort((left, right) =>
        createSceneContextCacheStorageKey(left).localeCompare(
          createSceneContextCacheStorageKey(right)
        )
      );
  }
}
