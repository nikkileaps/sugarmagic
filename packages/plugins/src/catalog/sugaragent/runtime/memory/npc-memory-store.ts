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

import {
  gameScopedStorageName,
  getActivePlaythroughId,
  getActiveUserId
} from "@sugarmagic/runtime-core";

/** Current record schema. Bump when the record shape changes
 *  incompatibly; `migrateRecord` owns the upgrade path.
 *  v2 (Plan 080): list fields hold scored items, not plain strings;
 *  `disclosures` added. */
export const NPC_MEMORY_SCHEMA_VERSION = 2;

/** Salience bounds for a memory item's importance -- Generative Agents
 *  "poignancy" (1 = mundane, 10 = pivotal). Plan 080 §D2/§D5. */
export const MIN_ITEM_IMPORTANCE = 1;
export const MAX_ITEM_IMPORTANCE = 10;
/** Importance for an item that carries no score -- a migrated v1 string,
 *  or a pre-080.2 summary delta. Neutral-mid so it neither starves nor
 *  dominates ranking. */
export const DEFAULT_ITEM_IMPORTANCE = 5;

/** IndexedDB database name prefix; the active userId is appended so
 *  each user gets an isolated database (sugarlang card-store idiom). */
/** Distinguishes this plugin's memory database from a game's other storage.
 *  The full name leads with the GAME id -- a player's device carries the name
 *  of the game they are playing, not of the tool it was built with, and two
 *  games previewed on one origin must not share NPC memory. */
const DB_NAME_SEGMENT = "sugaragent-npc-memory";
const OBJECT_STORE_NAME = "npc-memory";
const DB_VERSION = 1;

/** Last-exchange continuity text is truncated to keep records
 *  bounded; the full transcript never enters the durable record. */
const DEFAULT_LAST_EXCHANGE_MAX_CHARS = 600;

/**
 * One durable memory item: the text, its salience score, and the
 * conversationCounter when it was last added or refreshed (the recency
 * key for salience ranking). Plan 080 §D2.
 */
export interface ScoredMemoryItem {
  text: string;
  /** Salience 1-10 (Generative Agents poignancy). */
  importance: number;
  /** conversationCounter at last add/refresh -- recency for ranking. */
  lastUpdated: number;
}

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
  /** Salient facts learned about the player (LLM), scored + accumulated. */
  salientFacts: ScoredMemoryItem[];
  /** Promises / undertakings made (LLM), scored + accumulated. */
  promises: ScoredMemoryItem[];
  /** Emotional beats worth remembering (LLM), scored + accumulated. */
  emotionalBeats: ScoredMemoryItem[];
  /** Things the NPC has already SHARED with the player (self-disclosure).
   *  The cross-conversation repetition lever -- Plan 080 §D4. */
  disclosures: ScoredMemoryItem[];
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

/** A scored item as it arrives in a summary delta -- text + importance,
 *  no `lastUpdated` (the store stamps recency from the conversation
 *  counter at merge time). Plan 080 §080.2. */
export interface SummaryScoredItem {
  text: string;
  importance: number;
}

/** The async LLM-summary upgrade (Plan 073 §D3 phase 2). Every
 *  field is optional — a partial summary merges only what it carries,
 *  leaving the rest of the record intact. */
export interface SummaryMemoryDelta {
  npcDefinitionId: string;
  relationshipSummary?: string;
  salientFacts?: SummaryScoredItem[];
  promises?: SummaryScoredItem[];
  emotionalBeats?: SummaryScoredItem[];
  /** Things the NPC told the player about ITSELF this conversation -- the
   *  cross-conversation repetition lever. Plan 080 §D4. */
  disclosures?: SummaryScoredItem[];
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

function coerceCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** Clamp/round an unknown into the valid importance band, defaulting a
 *  missing/invalid score to the neutral-mid value. */
export function clampImportance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ITEM_IMPORTANCE;
  }
  return Math.min(
    MAX_ITEM_IMPORTANCE,
    Math.max(MIN_ITEM_IMPORTANCE, Math.round(value))
  );
}

/**
 * Convert legacy plain strings into scored items at the default
 * importance, timestamped to the given conversationCounter. Used by the
 * v1->v2 migration (a v1 record's list fields were plain strings).
 * Non-strings/empties drop.
 */
function stringsToScoredItems(value: unknown, timestamp: number): ScoredMemoryItem[] {
  if (!Array.isArray(value)) return [];
  const items: ScoredMemoryItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.trim();
    if (text.length === 0) continue; // trim BEFORE the length check (080.6)
    items.push({
      text,
      importance: DEFAULT_ITEM_IMPORTANCE,
      lastUpdated: timestamp
    });
  }
  return items;
}

/**
 * Map a summary delta's scored items into durable items, clamping
 * importance and stamping recency from the conversation counter. Empties
 * drop. Plan 080 §080.2.
 */
function itemsFromDelta(
  items: SummaryScoredItem[],
  timestamp: number
): ScoredMemoryItem[] {
  const out: ScoredMemoryItem[] = [];
  for (const item of items) {
    if (!item || typeof item.text !== "string") continue;
    const text = item.text.trim();
    if (text.length === 0) continue; // trim BEFORE the length check (080.6)
    out.push({
      text,
      importance: clampImportance(item.importance),
      lastUpdated: timestamp
    });
  }
  return out;
}

/** Normalize item text for dedup: lowercase, collapse whitespace, strip
 *  surrounding punctuation. */
function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
}

/**
 * Code-level near-match test (Plan 080 §D2 -- no embeddings in v1). Two
 * item texts are "the same memory" when their normalized forms are equal
 * or their word sets overlap heavily (Jaccard >= 0.6, e.g. "loves aged
 * gouda" vs "loves gouda"). Deliberately conservative -- better semantic
 * dedup is the deferred reflection pass.
 *
 * We intentionally do NOT treat substring containment as a match: it
 * false-merges a fact with its own negation ("married" vs "not married
 * anymore"), which would silently retain the stale fact and drop the
 * correction. Jaccard already covers the intended reworded-duplicate
 * cases (080.6, mini-review finding).
 */
function isNearMatch(a: string, b: string): boolean {
  const na = normalizeItemText(a);
  const nb = normalizeItemText(b);
  if (na.length === 0 || nb.length === 0) return na === nb;
  if (na === nb) return true;
  const sa = new Set(na.split(" ").filter(Boolean));
  const sb = new Set(nb.split(" ").filter(Boolean));
  let intersection = 0;
  for (const word of sa) {
    if (sb.has(word)) intersection += 1;
  }
  const union = sa.size + sb.size - intersection;
  return union > 0 && intersection / union >= 0.6;
}

/**
 * Accumulate incoming scored items into an existing list (Plan 080 §D2,
 * §080.3): a near/exact match refreshes the existing item's recency and
 * lifts its importance (max); a novel item is appended. Intra-batch dups
 * collapse too (a later incoming item can match an already-appended one).
 *
 * NOTE: this does NOT evict -- the list grows across conversations by
 * design. Hard soft-forget eviction and the LLM reflection/compaction pass
 * are deferred (Plan 080 Deferred + §D6); the digest RENDER (080.4) bounds
 * what is actually injected each conversation via salience ranking.
 */
function reconcileItems(
  existing: ScoredMemoryItem[],
  incoming: ScoredMemoryItem[]
): ScoredMemoryItem[] {
  const merged = existing.map((item) => ({ ...item }));
  for (const item of incoming) {
    const match = merged.find((candidate) => isNearMatch(candidate.text, item.text));
    if (match) {
      match.lastUpdated = Math.max(match.lastUpdated, item.lastUpdated);
      match.importance = Math.max(match.importance, item.importance);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

/** Defensively coerce a stored v2 scored-item list: keep well-formed
 *  items, clamp importance, default a missing timestamp. */
function coerceScoredItems(value: unknown, fallbackTimestamp: number): ScoredMemoryItem[] {
  if (!Array.isArray(value)) return [];
  const items: ScoredMemoryItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<ScoredMemoryItem>;
    if (typeof candidate.text !== "string") continue;
    const text = candidate.text.trim();
    if (text.length === 0) continue; // trim BEFORE the length check (080.6)
    items.push({
      text,
      importance: clampImportance(candidate.importance),
      lastUpdated:
        typeof candidate.lastUpdated === "number" &&
        Number.isFinite(candidate.lastUpdated) &&
        candidate.lastUpdated >= 0
          ? Math.floor(candidate.lastUpdated)
          : fallbackTimestamp
    });
  }
  return items;
}

/**
 * Coerce a possibly-partial / older-version stored object into a
 * valid current-version record. Missing fields take defaults and
 * `schemaVersion` is stamped current — this doubles as the forward
 * migration seam and a defensive read. Returns `null` for a
 * non-object (absent record).
 *
 * Plan 080 §080.1: the list fields changed shape (string[] -> scored
 * items) at v2, so we read the RAW stored `schemaVersion` BEFORE the
 * return stamps it current, and branch the coercer: v1 (and any legacy
 * version < 2) stored plain strings -> convert to scored items at the
 * default importance, timestamped to the record's conversationCounter;
 * v2+ already stores scored items -> coerce defensively. `disclosures`
 * did not exist pre-v2, so a v1 record's (undefined) disclosures becomes
 * an empty list.
 */
export function migrateNpcMemoryRecord(raw: unknown): NpcMemoryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<NpcMemoryRecord> & { schemaVersion?: unknown };
  if (typeof record.key !== "string") return null;

  const storedVersion = coerceCount(record.schemaVersion);
  const conversationCounter = coerceCount(record.conversationCounter);
  const toItems = (value: unknown): ScoredMemoryItem[] =>
    storedVersion >= 2
      ? coerceScoredItems(value, conversationCounter)
      : stringsToScoredItems(value, conversationCounter);

  return {
    key: record.key,
    userId: coerceString(record.userId),
    playthroughId: coerceString(record.playthroughId),
    npcDefinitionId: coerceString(record.npcDefinitionId),
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    metCount: coerceCount(record.metCount),
    conversationCounter,
    lastExchange: coerceString(record.lastExchange),
    relationshipSummary: coerceString(record.relationshipSummary),
    salientFacts: toItems(record.salientFacts),
    promises: toItems(record.promises),
    emotionalBeats: toItems(record.emotionalBeats),
    disclosures: toItems(record.disclosures),
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
          gameScopedStorageName(DB_NAME_SEGMENT, this.userId),
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
      disclosures: [],
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
  /**
   * Phase-2 summary upgrade (Plan 073 §D3), now ACCUMULATING (Plan 080
   * §080.3). Each scored list is reconciled (upsert) against the existing
   * items rather than replaced: a near/exact match refreshes recency +
   * importance, a novel item is appended. The two prose summary fields
   * (relationship / last-conversation) still replace, since they are
   * "latest summary", not accumulating collections. The staleness gate is
   * unchanged: a summary older than the applied one is dropped wholesale.
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
        record.salientFacts = reconcileItems(
          record.salientFacts,
          itemsFromDelta(delta.salientFacts, counter)
        );
      }
      if (delta.promises !== undefined) {
        record.promises = reconcileItems(
          record.promises,
          itemsFromDelta(delta.promises, counter)
        );
      }
      if (delta.emotionalBeats !== undefined) {
        record.emotionalBeats = reconcileItems(
          record.emotionalBeats,
          itemsFromDelta(delta.emotionalBeats, counter)
        );
      }
      if (delta.disclosures !== undefined) {
        record.disclosures = reconcileItems(
          record.disclosures,
          itemsFromDelta(delta.disclosures, counter)
        );
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

  /**
   * Dev-only (Plan 073.5): every memory record for the current
   * (userId, playthroughId), for the inspection handle. Not used by the game.
   */
  debugListRecords(): Promise<NpcMemoryRecord[]> {
    return this.enqueue(async () => {
      const rows = await this.backend.all();
      return rows
        .map((raw) => migrateNpcMemoryRecord(raw))
        .filter(
          (record): record is NpcMemoryRecord =>
            record != null &&
            record.userId === this.userId &&
            record.playthroughId === this.playthroughId
        );
    });
  }

  /**
   * Dev-only (Plan 073.5): forget this playthrough's memory of one NPC, or of
   * ALL NPCs when `npcDefinitionId` is omitted. Lets Claude/nikki re-test the
   * first-meeting path in preview without a New Game.
   */
  debugForget(npcDefinitionId?: string): Promise<void> {
    return this.enqueue(async () => {
      if (npcDefinitionId) {
        await this.backend.delete(this.keyFor(npcDefinitionId));
        return;
      }
      const rows = await this.backend.all();
      for (const raw of rows) {
        const record = migrateNpcMemoryRecord(raw);
        if (!record) continue;
        if (
          record.userId === this.userId &&
          record.playthroughId === this.playthroughId
        ) {
          await this.backend.delete(record.key);
        }
      }
    });
  }
}
