/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/npc-memory-store.ts
 *
 * Purpose: the plugin-owned, device-local store for what an NPC
 * remembers about the player across conversations and sessions.
 * One compact structured record per NPC per playthrough per user.
 *
 * ## Boundary (Plan 073 §D1, ADR 020)
 *
 * This is NOT a SaveParticipant slice and NOT gateway-side. The
 * shared game save explicitly excludes per-plugin per-user data;
 * each plugin owns its own store keyed on the runtime identity.
 * Memory content lives ONLY on the local device (IndexedDB, or an
 * in-memory fallback when IndexedDB is absent). Cross-device /
 * server sync is a named non-goal — this store's API is the seam
 * if it's ever added.
 *
 * ## Keying (Plan 073 §D1)
 *
 * `userId + playthroughId + npcDefinitionId`. The playthroughId
 * (from runtime-core's `getActivePlaythroughId`) is what makes
 * New Game forget: a fresh playthrough mints a new id, so its keys
 * miss every prior record and `load` returns empty. The IndexedDB
 * database is additionally scoped per-user so users never share a
 * database file.
 *
 * ## Two-phase write (Plan 073 §D3)
 *
 *   - `mergeDeterministic` is the SYNCHRONOUS-at-dispose delta
 *     (metCount++, conversationCounter++, truncated last exchange).
 *     It returns the new conversationCounter so the caller can tag
 *     the async summary that follows.
 *   - `mergeSummary(delta, counter)` is the ASYNC UPGRADE (an LLM
 *     summarization landing later). It is gated by the monotonic
 *     counter: a summary for conversation N never overwrites a
 *     record already advanced past N (a late summarizer from an
 *     earlier conversation can't clobber a newer one).
 *
 * All operations serialize on a single promise chain (the
 * serialized-save-store idiom) so a `load` issued after a merge
 * observes that merge, with no callsite coordination.
 *
 * Implements: Plan 073 §073.1 (D1, D2, D3)
 *
 * Status: active
 */

import { getActivePlaythroughId, getActiveUserId } from "@sugarmagic/runtime-core";

/** Current record schema. Bump when the record shape changes
 *  incompatibly; `migrateRecord` owns the upgrade path. */
export const NPC_MEMORY_SCHEMA_VERSION = 1;

/** IndexedDB database name prefix; the active userId is appended so
 *  each user gets an isolated database (sugarlang card-store idiom). */
const DB_NAME_PREFIX = "sugaragent-npc-memory";
const OBJECT_STORE_NAME = "npc-memory";
const DB_VERSION = 1;

/** Last-exchange continuity text is truncated to keep records
 *  bounded; the full transcript never enters the durable record. */
const DEFAULT_LAST_EXCHANGE_MAX_CHARS = 600;

/**
 * One NPC's memory of the player for a single playthrough. Tier 1
 * (durable structured memory) and tier 2 (continuity — the freshest
 * conversation summary) are the same record; there is no separate
 * continuity mechanism (Plan 073 §D2).
 */
export interface NpcMemoryRecord {
  /** `${userId}::${playthroughId}::${npcDefinitionId}` — the store key. */
  key: string;
  userId: string;
  playthroughId: string;
  npcDefinitionId: string;
  schemaVersion: number;
  /** How many distinct conversations have occurred. */
  metCount: number;
  /** Monotonic per-conversation counter; the summary staleness gate. */
  conversationCounter: number;
  /** Truncated most-recent exchange — the deterministic continuity floor. */
  lastExchange: string;
  /** Durable relationship summary (LLM). */
  relationshipSummary: string;
  /** Salient facts learned about the player (LLM). */
  salientFacts: string[];
  /** Promises / undertakings made (LLM). */
  promises: string[];
  /** Emotional beats worth remembering (LLM). */
  emotionalBeats: string[];
  /** Freshest conversation's summary (tier 2 continuity). */
  lastConversationSummary: string;
  /** The conversationCounter the current summary reflects; a summary
   *  delta with a lower counter is rejected as stale. */
  summaryCounter: number;
}

/** The synchronous-at-dispose delta (Plan 073 §D3 phase 1). */
export interface DeterministicMemoryDelta {
  npcDefinitionId: string;
  /** Raw last exchange; the store truncates it. */
  lastExchange: string;
}

/** The async LLM-summary upgrade (Plan 073 §D3 phase 2). Every
 *  field is optional — a partial summary merges only what it carries,
 *  leaving the rest of the record intact. */
export interface SummaryMemoryDelta {
  npcDefinitionId: string;
  relationshipSummary?: string;
  salientFacts?: string[];
  promises?: string[];
  emotionalBeats?: string[];
  lastConversationSummary?: string;
}

/**
 * Backend the store reads/writes through. Two implementations:
 * IndexedDB (device-durable) and in-memory (fallback + tests). The
 * store owns all merge/staleness/migration/serialization logic; the
 * backend is a dumb key-value surface.
 */
export interface NpcMemoryBackend {
  get(key: string): Promise<unknown | undefined>;
  put(record: NpcMemoryRecord): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every record in the backend — used by `reset` to prune stale
   *  playthroughs. */
  all(): Promise<unknown[]>;
}

export interface NpcMemoryStoreOptions {
  /** Stable user id. Defaults to `getActiveUserId()`. */
  userId?: string | null;
  /** Active playthrough id. Defaults to `getActivePlaythroughId()`. */
  playthroughId?: string | null;
  /** Inject a backend directly (tests). Overrides IDB/in-memory
   *  selection. */
  backend?: NpcMemoryBackend;
  /** IndexedDB factory. Defaults to `globalThis.indexedDB`. When both
   *  this and the global are absent, the store falls back to memory. */
  indexedDbFactory?: IDBFactory | null;
  /** Override the last-exchange truncation cap. */
  lastExchangeMaxChars?: number;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function coerceCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/**
 * Coerce a possibly-partial / older-version stored object into a
 * valid current-version record. Missing fields take defaults and
 * `schemaVersion` is stamped current — this doubles as the forward
 * migration seam and a defensive read. Returns `null` for a
 * non-object (absent record).
 */
export function migrateNpcMemoryRecord(raw: unknown): NpcMemoryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<NpcMemoryRecord>;
  if (typeof record.key !== "string") return null;
  return {
    key: record.key,
    userId: coerceString(record.userId),
    playthroughId: coerceString(record.playthroughId),
    npcDefinitionId: coerceString(record.npcDefinitionId),
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    metCount: coerceCount(record.metCount),
    conversationCounter: coerceCount(record.conversationCounter),
    lastExchange: coerceString(record.lastExchange),
    relationshipSummary: coerceString(record.relationshipSummary),
    salientFacts: coerceStringArray(record.salientFacts),
    promises: coerceStringArray(record.promises),
    emotionalBeats: coerceStringArray(record.emotionalBeats),
    lastConversationSummary: coerceString(record.lastConversationSummary),
    summaryCounter: coerceCount(record.summaryCounter)
  };
}

/**
 * In-memory backend. Used when IndexedDB is unavailable (SSR, some
 * headless contexts) and as the default test backend. Not durable —
 * lives for the instance's lifetime only.
 */
export class InMemoryNpcMemoryBackend implements NpcMemoryBackend {
  private readonly records = new Map<string, NpcMemoryRecord>();

  async get(key: string): Promise<unknown | undefined> {
    const record = this.records.get(key);
    return record ? { ...record } : undefined;
  }

  async put(record: NpcMemoryRecord): Promise<void> {
    this.records.set(record.key, { ...record });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async all(): Promise<unknown[]> {
    return Array.from(this.records.values()).map((record) => ({ ...record }));
  }
}

/**
 * IndexedDB backend, scoped per-user via the database name. Molds the
 * request/transaction helpers from sugarlang's `IndexedDBCardStore`.
 */
export class IndexedDBNpcMemoryBackend implements NpcMemoryBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly indexedDbFactory: IDBFactory;

  constructor(
    private readonly userId: string,
    indexedDbFactory: IDBFactory
  ) {
    this.indexedDbFactory = indexedDbFactory;
  }

  async get(key: string): Promise<unknown | undefined> {
    return this.awaitRequest(
      await this.objectStore("readonly", (store) => store.get(key))
    );
  }

  async put(record: NpcMemoryRecord): Promise<void> {
    await this.awaitRequest(
      await this.objectStore("readwrite", (store) => store.put(record))
    );
  }

  async delete(key: string): Promise<void> {
    await this.awaitRequest(
      await this.objectStore("readwrite", (store) => store.delete(key))
    );
  }

  async all(): Promise<unknown[]> {
    return this.awaitRequest<unknown[]>(
      await this.objectStore("readonly", (store) => store.getAll())
    );
  }

  private async objectStore<TValue>(
    mode: IDBTransactionMode,
    select: (store: IDBObjectStore) => IDBRequest<TValue>
  ): Promise<IDBRequest<TValue>> {
    const db = await this.database();
    const transaction = db.transaction(OBJECT_STORE_NAME, mode);
    return select(transaction.objectStore(OBJECT_STORE_NAME));
  }

  private async database(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.indexedDbFactory.open(
          `${DB_NAME_PREFIX}:${this.userId}`,
          DB_VERSION
        );
        request.onerror = () => {
          reject(
            request.error ?? new Error("Failed to open NPC memory database.")
          );
        };
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
            db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "key" });
          }
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
      });
    }
    return this.dbPromise;
  }

  private async awaitRequest<TValue>(request: IDBRequest<TValue>): Promise<TValue> {
    return new Promise<TValue>((resolve, reject) => {
      request.onerror = () => {
        reject(request.error ?? new Error("NPC memory request failed."));
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }
}

function resolveBackend(options: NpcMemoryStoreOptions, userId: string): NpcMemoryBackend {
  if (options.backend) return options.backend;
  const factory =
    "indexedDbFactory" in options
      ? options.indexedDbFactory ?? null
      : globalThis.indexedDB ?? null;
  if (factory) return new IndexedDBNpcMemoryBackend(userId, factory);
  return new InMemoryNpcMemoryBackend();
}

/**
 * The store. Construct ONE per (userId, playthroughId); a New Game
 * reload mints a new playthroughId, so the next store instance keys
 * fresh records. Identity defaults to the runtime registries but can
 * be injected for tests.
 */
export class NpcMemoryStore {
  private readonly userId: string;
  private readonly playthroughId: string;
  private readonly backend: NpcMemoryBackend;
  private readonly lastExchangeMaxChars: number;
  /** Single promise chain — every op appends and serializes behind
   *  the last, so ordering holds without callsite coordination. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: NpcMemoryStoreOptions = {}) {
    const userId = options.userId ?? getActiveUserId();
    const playthroughId = options.playthroughId ?? getActivePlaythroughId();
    if (!userId || !playthroughId) {
      throw new Error(
        "[sugaragent] NpcMemoryStore requires a resolved userId and " +
          "playthroughId. Identity is not ready yet — defer construction " +
          "until after boot's save deserialize has settled the playthroughId."
      );
    }
    this.userId = userId;
    this.playthroughId = playthroughId;
    this.backend = resolveBackend(options, userId);
    this.lastExchangeMaxChars =
      options.lastExchangeMaxChars ?? DEFAULT_LAST_EXCHANGE_MAX_CHARS;
  }

  /** The playthrough this store instance is bound to. */
  get boundPlaythroughId(): string {
    return this.playthroughId;
  }

  private keyFor(npcDefinitionId: string): string {
    return `${this.userId}::${this.playthroughId}::${npcDefinitionId}`;
  }

  private emptyRecord(npcDefinitionId: string): NpcMemoryRecord {
    return {
      key: this.keyFor(npcDefinitionId),
      userId: this.userId,
      playthroughId: this.playthroughId,
      npcDefinitionId,
      schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
      metCount: 0,
      conversationCounter: 0,
      lastExchange: "",
      relationshipSummary: "",
      salientFacts: [],
      promises: [],
      emotionalBeats: [],
      lastConversationSummary: "",
      summaryCounter: 0
    };
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    // Swallow on the retained tail so one failed op can't poison the
    // next, but return the un-swallowed promise so callers still see
    // their own failure.
    this.chain = next.catch(() => {});
    return next;
  }

  private async readRecord(npcDefinitionId: string): Promise<NpcMemoryRecord | null> {
    const raw = await this.backend.get(this.keyFor(npcDefinitionId));
    return migrateNpcMemoryRecord(raw);
  }

  private truncateExchange(text: string): string {
    if (text.length <= this.lastExchangeMaxChars) return text;
    return text.slice(0, this.lastExchangeMaxChars);
  }

  /** The NPC's memory for the current playthrough, or `null` if none
   *  yet (fresh NPC / New Game). Ordered behind any in-flight merge. */
  load(npcDefinitionId: string): Promise<NpcMemoryRecord | null> {
    return this.enqueue(() => this.readRecord(npcDefinitionId));
  }

  /**
   * Phase-1 deterministic merge (Plan 073 §D3). Bumps metCount +
   * conversationCounter and stores the truncated last exchange.
   * Returns the new conversationCounter so the caller tags the async
   * summary that follows.
   */
  mergeDeterministic(
    delta: DeterministicMemoryDelta
  ): Promise<{ conversationCounter: number }> {
    return this.enqueue(async () => {
      const record =
        (await this.readRecord(delta.npcDefinitionId)) ??
        this.emptyRecord(delta.npcDefinitionId);
      record.metCount += 1;
      record.conversationCounter += 1;
      record.lastExchange = this.truncateExchange(delta.lastExchange);
      await this.backend.put(record);
      return { conversationCounter: record.conversationCounter };
    });
  }

  /**
   * Phase-2 summary upgrade (Plan 073 §D3). Applies only the fields
   * the delta carries, and only when `counter` is not older than the
   * record's current `summaryCounter` (stale-summary gate). Returns
   * whether the summary was applied.
   */
  mergeSummary(delta: SummaryMemoryDelta, counter: number): Promise<boolean> {
    return this.enqueue(async () => {
      const record =
        (await this.readRecord(delta.npcDefinitionId)) ??
        this.emptyRecord(delta.npcDefinitionId);
      if (counter < record.summaryCounter) {
        // A summary from an earlier conversation than one already
        // applied — drop it rather than regress the record.
        return false;
      }
      if (delta.relationshipSummary !== undefined) {
        record.relationshipSummary = delta.relationshipSummary;
      }
      if (delta.salientFacts !== undefined) {
        record.salientFacts = [...delta.salientFacts];
      }
      if (delta.promises !== undefined) {
        record.promises = [...delta.promises];
      }
      if (delta.emotionalBeats !== undefined) {
        record.emotionalBeats = [...delta.emotionalBeats];
      }
      if (delta.lastConversationSummary !== undefined) {
        record.lastConversationSummary = delta.lastConversationSummary;
      }
      record.summaryCounter = counter;
      await this.backend.put(record);
      return true;
    });
  }

  /**
   * Prune records that don't belong to this store's playthrough
   * (Plan 073 §D1 — "reset on playthroughId change detected on
   * load"). New Game keying already isolates a fresh playthrough's
   * reads; this reclaims the prior playthrough's rows so the
   * device-local database doesn't grow unbounded across New Games.
   * Idempotent.
   */
  reset(): Promise<void> {
    return this.enqueue(async () => {
      const rows = await this.backend.all();
      for (const raw of rows) {
        const record = migrateNpcMemoryRecord(raw);
        if (!record) continue;
        if (record.userId !== this.userId) continue;
        if (record.playthroughId !== this.playthroughId) {
          await this.backend.delete(record.key);
        }
      }
    });
  }
}
