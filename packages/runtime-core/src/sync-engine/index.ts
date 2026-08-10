/**
 * packages/runtime-core/src/sync-engine/index.ts
 *
 * Purpose: Per-account keyed storage that any plugin can use, where the local
 *   copy is the source of every read and write and syncing to the player's
 *   account happens in the background.
 *
 * WHY THIS EXISTS
 *   Plugins kept hand-rolling it, each with its own interface, its own
 *   IndexedDB open, its own memory fallback, and its own idea of how to key a
 *   player. Most of them keyed on something that was not the account, which
 *   means two people sharing a browser share their data, and none of them
 *   could reach the account, so none of it followed anyone to a second
 *   machine. One mechanism means the next plugin inherits those answers
 *   instead of re-deriving them.
 *
 * LOCAL IS PRIMARY, THE SERVER IS A PEER
 *   Reads and writes go to the local copy and return immediately; a local
 *   write IS the state. Reconciliation happens later and separately. This is
 *   the standard local-first arrangement, and it is what keeps the game
 *   playable with no network and keeps large data off the save path -- the
 *   autosave heartbeat re-serialises its whole payload every few seconds to
 *   detect change, so anything that grows must not live there.
 *
 * SYNCED VS LOCAL-ONLY IS DECLARED, NOT INFERRED
 *   `createLocalRecordStore` and `createSyncedRecordStore` return DIFFERENT
 *   TYPES. Only a synced store carries sync bookkeeping and registers with the
 *   sync loop. You cannot accidentally sync a cache, and you cannot declare
 *   something synced and forget to wire it up. Data that must stay local --
 *   compile caches, the telemetry ring buffer, project handles -- asks for the
 *   local one and says so in its own header.
 *
 * NO PLUGIN IS NAMED HERE, EVER
 *   `pluginId` is data this module is handed, never a value it knows. A test
 *   reads this file's source and fails if a plugin name appears in it, the
 *   same guard Plan 092.1 put on the asset collector. The host already drifted
 *   the other way once by importing a specific plugin's id, so the rule needs
 *   an enforcer rather than a convention.
 *
 * Exports:
 *   - RecordEntry, RecordStore, LocalRecordStore, SyncedRecordStore
 *   - RecordStoreSpec, RecordStoreKey, formatRecordStoreKey
 *   - createLocalRecordStore, createSyncedRecordStore
 *   - SyncHandle, StoredRecord
 *   - registerSyncedRecordStore, unregisterSyncedRecordStore,
 *     listSyncedRecordStores
 *   - RemoteRecordStorageAdapter, RemoteRecord, RemotePushResult
 *
 * Implements: Plan 092 story 092.6.2
 *
 * Status: active
 */

import { getActiveUserId } from "../identity/access-token-registry";
import {
  registerPlayerStore,
  unregisterPlayerStore
} from "../player-stores";
import {
  createIndexedDBRecordStorage,
  createMemoryRecordStorage,
  type LocalRecordStorageAdapter
} from "./local-record-storage";

/** Default page size for cursor reads. Matches the card store this replaces. */
export const RECORD_STORE_PAGE_SIZE = 250;

/**
 * Keys starting with this are the store's own bookkeeping (sync watermarks)
 * and are never returned to a caller. U+0000 sorts before every printable
 * character, so reserved rows sit at the front of the keyspace and a cursor
 * walk skips them once rather than filtering every page.
 */
const RESERVED_KEY_PREFIX = "\u0000";
const WATERMARK_KEY = `${RESERVED_KEY_PREFIX}watermark`;

/** One record as a caller sees it. */
export interface RecordEntry<TData = unknown> {
  key: string;
  data: TData;
}

/**
 * One record as it is stored, with the bookkeeping the sync loop reads.
 *
 * `updatedAtMs` is a LOCAL clock and orders this device's own edits only.
 * Cross-device ordering uses `syncedAt`, which is stamped by the server --
 * client clocks disagree and a wrong one silently wins arguments.
 */
export interface StoredRecord<TData = unknown> {
  key: string;
  /** null when this is a tombstone. */
  data: TData | null;
  schemaVersion: number;
  updatedAtMs: number;
  deleted: boolean;
  /** 1 when this edit has not reached the server yet. Indexed, so the sync
   *  loop finds work without scanning every record. Numeric because
   *  IndexedDB cannot index a boolean. */
  pending: 0 | 1;
  /** Server timestamp this record was last reconciled against. */
  syncedAt: string | null;
}

/** Identifies one store: which plugin, which of its stores, whose account. */
export interface RecordStoreKey {
  pluginId: string;
  storeId: string;
  /**
   * The player this data belongs to. A PLAYER, not a general-purpose scope,
   * and it should stay that way.
   *
   * IF YOU NEED DATA SCOPED BY SOMETHING ELSE -- per chapter, per region, per
   * playthrough -- ADD A COLUMN to the plugin's table and a matching security
   * rule. Do not widen this field to carry it. Locally it would work, because
   * this is only part of a database name; remotely it cannot, because the
   * database's isolation rule is "you may only read rows whose user_id is your
   * account", and that is the only thing keeping one player out of another's
   * data. A field holding "region-3" gives it nothing to check.
   */
  userId: string;
}

export function formatRecordStoreKey(key: RecordStoreKey): string {
  return `${key.pluginId}:${key.storeId}:${key.userId}`;
}

export interface RecordStoreSpec<TData> {
  /** The owning plugin's id. Data, not knowledge -- see the module header. */
  pluginId: string;
  /** Distinguishes this store from the same plugin's other stores. */
  storeId: string;
  /** Bumped when the stored shape changes in a way a reader must notice. */
  schemaVersion: number;
  /**
   * Upgrades a record written by an older version, applied ON READ.
   *
   * A PARAMETER rather than something each plugin remembers to do. Every
   * hand-rolled store before this either did it at some read sites and not
   * others, or not at all; making it part of the contract means a plugin gets
   * it right by not thinking about it. Return null to drop a record that
   * cannot be upgraded -- it is deleted rather than handed back malformed.
   */
  migrate?: (data: unknown, storedVersion: number) => TData | null;
  /**
   * Where this store's records live on the server. Required for a synced
   * store; meaningless for a local-only one, which never leaves the device.
   */
  table?: RemoteTableSpec<TData>;
  /** Test seam. Omit in production. */
  adapter?: LocalRecordStorageAdapter;
  /** Test seam: the account to use instead of the signed-in one. */
  userId?: string;
}

export interface RecordStore<TData = unknown> {
  readonly storeKey: RecordStoreKey;
  readonly syncMode: "local-only" | "synced";
  get(key: string): Promise<TData | undefined>;
  put(key: string, data: TData): Promise<void>;
  putMany(entries: ReadonlyArray<RecordEntry<TData>>): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<RecordEntry<TData>[]>;
  listPage(
    cursor: string | null,
    limit?: number
  ): Promise<{ records: RecordEntry<TData>[]; nextCursor: string | null }>;
  count(): Promise<number>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

/** Never leaves the device. Not visible to the sync loop. */
export interface LocalRecordStore<TData = unknown> extends RecordStore<TData> {
  readonly syncMode: "local-only";
}

/** Reconciled with the player's account in the background. */
export interface SyncedRecordStore<TData = unknown> extends RecordStore<TData> {
  readonly syncMode: "synced";
}

// ---------------------------------------------------------------------------
// What the sync loop sees
// ---------------------------------------------------------------------------

/**
 * How a plugin's records map to ITS OWN TABLE.
 *
 * The plugin owns the schema and ships the migration that creates it, so its
 * data lands in real typed columns that the database can index and constrain
 * -- not as opaque JSON in a shared heap. This mechanism owns four columns and
 * nothing else:
 *
 *   user_id     who it belongs to, and what row-level security scopes on
 *   record_key  which record
 *   deleted     a tombstone, so a delete cannot be undone by the next pull
 *   updated_at  stamped by the database; the ordering authority for conflicts
 *
 * Everything else is the plugin's. `toColumns` must not return any of the
 * four; `fromColumns` is handed the whole row and takes what it wants.
 */
export interface RemoteTableSpec<TData = unknown> {
  /** The plugin's own table, created by the plugin's own migration. */
  tableName: string;
  toColumns: (data: TData) => Record<string, unknown>;
  fromColumns: (row: Record<string, unknown>) => TData;
}

/** Columns this mechanism owns. A plugin's `toColumns` may not write them. */
export const REMOTE_TABLE_RESERVED_COLUMNS = [
  "user_id",
  "record_key",
  "deleted",
  "updated_at"
] as const;

/** A record as it travels to and from the server. */
export interface RemoteRecord {
  key: string;
  /** The plugin's own columns. Null for a tombstone. */
  columns: Record<string, unknown> | null;
  deleted: boolean;
  /** Server-stamped. The ordering authority for last-write-wins. */
  updatedAt: string;
}

export interface RemotePushResult {
  /** Server timestamps for what was accepted, so the local copy can record
   *  what it has been reconciled against. */
  accepted: Array<{ key: string; updatedAt: string }>;
}

/**
 * The server side of a synced store. Declared here and implemented by a
 * PLUGIN -- exactly how `GameSaveStore` works -- so runtime-core never learns
 * which backend a project uses, and a project with no account plugin
 * installed still gets a working local store.
 *
 * It is handed the TABLE to work against rather than choosing one, so the
 * implementation is generic over every plugin's schema and names none of them.
 */
export interface RemoteRecordStorageAdapter {
  pull(
    key: RecordStoreKey,
    table: RemoteTableSpec,
    since: string | null,
    limit: number
  ): Promise<{ records: RemoteRecord[]; nextSince: string | null }>;
  push(
    key: RecordStoreKey,
    table: RemoteTableSpec,
    records: ReadonlyArray<RemoteRecord>
  ): Promise<RemotePushResult>;
}

/**
 * The privileged view the sync loop uses. Deliberately not on `RecordStore`:
 * a plugin should not be able to fake a sync or clear another store's
 * bookkeeping, and keeping it separate means the plugin-facing API stays
 * about reading and writing records.
 */
export interface SyncHandle {
  readonly storeKey: RecordStoreKey;
  /** The plugin's table. Handed to the remote so it works against the right
   *  schema without knowing whose it is. */
  readonly table: RemoteTableSpec;
  /** Records edited locally and not yet accepted by the server. */
  takePending(limit: number): Promise<StoredRecord[]>;
  /** Record that the server accepted these, with its timestamps. */
  markPushed(accepted: RemotePushResult["accepted"]): Promise<void>;
  /** Merge server records in. Returns how many actually changed anything. */
  applyRemote(records: ReadonlyArray<RemoteRecord>): Promise<{
    applied: number;
    skippedLocalNewer: number;
  }>;
  getWatermark(): Promise<string | null>;
  setWatermark(value: string): Promise<void>;
}

const syncedStores = new Map<string, SyncHandle>();

/**
 * Module-level, matching `access-token-registry`: plugin runtimes are built
 * before the host is in a position to hand them anything, so the host finds
 * them here rather than being threaded through every plugin's factory.
 */
export function registerSyncedRecordStore(handle: SyncHandle): void {
  syncedStores.set(formatRecordStoreKey(handle.storeKey), handle);
}

export function unregisterSyncedRecordStore(key: RecordStoreKey): void {
  syncedStores.delete(formatRecordStoreKey(key));
}

export function listSyncedRecordStores(): SyncHandle[] {
  return Array.from(syncedStores.values());
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function resolveUserId(spec: RecordStoreSpec<unknown>): string {
  const userId = spec.userId ?? getActiveUserId();
  if (userId && userId.length > 0) return userId;
  // Throws rather than degrading, for the reason Plan 092.6.1 settled: a store
  // opened without an account is shared by everyone using the browser, and
  // nothing written into it can be attributed to a person afterwards. A memory
  // fallback would hide that just as well as a wrong database would.
  throw new Error(
    `[sync-engine] store "${spec.pluginId}:${spec.storeId}" was created ` +
      "before an account resolved. Defer construction until identity has " +
      "settled -- storage opened without an account is shared by every " +
      "account using this browser."
  );
}

function resolveAdapter(
  spec: RecordStoreSpec<unknown>,
  storeKey: RecordStoreKey
): LocalRecordStorageAdapter {
  if (spec.adapter) return spec.adapter;
  try {
    return createIndexedDBRecordStorage(storeKey);
  } catch {
    // Every existing plugin store degrades this way when IndexedDB is absent
    // (tests, SSR). Data does not outlive the session, which is the honest
    // outcome when there is nowhere to put it.
    return createMemoryRecordStorage();
  }
}

function createStore<TData>(
  spec: RecordStoreSpec<TData>,
  syncMode: "local-only" | "synced"
): { store: RecordStore<TData>; adapter: LocalRecordStorageAdapter } {
  const storeKey: RecordStoreKey = {
    pluginId: spec.pluginId,
    storeId: spec.storeId,
    userId: resolveUserId(spec as RecordStoreSpec<unknown>)
  };
  const adapter = resolveAdapter(spec as RecordStoreSpec<unknown>, storeKey);

  /** Applies the migration and drops anything that cannot be upgraded. */
  function readData(stored: StoredRecord): TData | undefined {
    if (stored.deleted || stored.data === null) return undefined;
    if (stored.schemaVersion === spec.schemaVersion) return stored.data as TData;
    if (!spec.migrate) return undefined;
    const upgraded = spec.migrate(stored.data, stored.schemaVersion);
    return upgraded === null ? undefined : upgraded;
  }

  function toStored(key: string, data: TData | null, deleted: boolean): StoredRecord {
    return {
      key,
      data,
      schemaVersion: spec.schemaVersion,
      updatedAtMs: Date.now(),
      deleted,
      // A local-only store never has anything to push, so it never marks
      // anything pending -- that is the whole of the difference at write time.
      pending: syncMode === "synced" ? 1 : 0,
      syncedAt: null
    };
  }

  const store: RecordStore<TData> = {
    storeKey,
    syncMode,

    async get(key) {
      const stored = await adapter.read(key);
      return stored ? readData(stored) : undefined;
    },

    async put(key, data) {
      await adapter.write([toStored(key, data, false)]);
    },

    async putMany(entries) {
      if (entries.length === 0) return;
      await adapter.write(entries.map((e) => toStored(e.key, e.data, false)));
    },

    async delete(key) {
      // A tombstone, not a removal. Deleting the row outright would let the
      // next pull hand the record straight back -- the server has no way to
      // know it is gone.
      await adapter.write([toStored(key, null, true)]);
    },

    async listPage(cursor, limit = RECORD_STORE_PAGE_SIZE) {
      const page = await adapter.readPage(cursor ?? RESERVED_KEY_PREFIX, limit);
      const records: RecordEntry<TData>[] = [];
      for (const stored of page.records) {
        if (stored.key.startsWith(RESERVED_KEY_PREFIX)) continue;
        const data = readData(stored);
        if (data !== undefined) records.push({ key: stored.key, data });
      }
      return { records, nextCursor: page.nextCursor };
    },

    async list() {
      const all: RecordEntry<TData>[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await this.listPage(cursor, RECORD_STORE_PAGE_SIZE);
        all.push(...page.records);
        if (!page.nextCursor) return all;
        cursor = page.nextCursor;
      }
    },

    async count() {
      return (await this.list()).length;
    },

    async clear() {
      // A SYNCED store cannot just drop its rows. The server still has them,
      // so the next pull hands every one straight back and the clear looks
      // like it silently failed. Tombstoning each record is what actually
      // reaches the server -- the same reason `delete` writes a tombstone
      // rather than removing a row.
      if (syncMode === "local-only") {
        await adapter.removeAll();
        return;
      }
      // Walks the whole keyspace with a cursor. Re-reading from the start
      // each time would stop after one page: those records are tombstoned by
      // then, so the second read finds nothing live and quits with the rest of
      // the store untouched.
      let cursor = RESERVED_KEY_PREFIX;
      for (;;) {
        const page = await adapter.readPage(cursor, RECORD_STORE_PAGE_SIZE);
        if (page.records.length === 0) break;
        const live = page.records.filter((record) => !record.deleted);
        if (live.length > 0) {
          await adapter.write(live.map((record) => toStored(record.key, null, true)));
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
    },

    async close() {
      // Deregistered on close: a closed store cannot clear anything, and
      // leaving it listed would have a wipe report success for a store that
      // did nothing.
      unregisterPlayerStore(spec.pluginId, spec.storeId);
      await adapter.close?.();
    }
  };

  // Registered so a wipe can ASK this store to clear itself instead of
  // hunting for its database by name. Both kinds register: a local-only store
  // still holds a player's data and still has to go when they start over.
  registerPlayerStore({
    pluginId: spec.pluginId,
    storeId: spec.storeId,
    clear: () => store.clear()
  });

  return { store, adapter };
}

/** Storage that stays on this device. Invisible to the sync loop. */
export function createLocalRecordStore<TData>(
  spec: RecordStoreSpec<TData>
): LocalRecordStore<TData> {
  return createStore(spec, "local-only").store as LocalRecordStore<TData>;
}

/**
 * Storage that follows the player to their other devices.
 *
 * Registers itself with the sync loop on construction, so declaring one is
 * the whole of the wiring -- there is no second step to forget.
 */
export function createSyncedRecordStore<TData>(
  spec: RecordStoreSpec<TData> & { table: RemoteTableSpec<TData> }
): SyncedRecordStore<TData> {
  assertNoReservedColumns(spec.table as RemoteTableSpec<unknown>);
  // The sync handle shares the store's OWN adapter rather than opening a
  // second one against the same database -- two connections would mean two
  // caches of the same rows and a pending flag cleared in one being invisible
  // to the other.
  const { store, adapter } = createStore(spec, "synced");
  registerSyncedRecordStore(
    createSyncHandle(
      store.storeKey,
      spec.table as RemoteTableSpec,
      adapter,
      spec.schemaVersion
    )
  );
  return store as SyncedRecordStore<TData>;
}

/**
 * A plugin writing `updated_at` itself would let a device with a wrong clock
 * win every conflict it took part in; writing `user_id` would let it write
 * into another account's rows. Caught at construction rather than on the wire.
 */
function assertNoReservedColumns(table: RemoteTableSpec<unknown>): void {
  // Probed with an empty record: a spec that maps fixed column NAMES will
  // reveal them, which is the case worth catching. One that only emits columns
  // derived from data cannot clash by construction.
  let probe: Record<string, unknown> = {};
  try {
    probe = table.toColumns({} as never) ?? {};
  } catch {
    return;
  }
  const clash = REMOTE_TABLE_RESERVED_COLUMNS.filter((column) => column in probe);
  if (clash.length === 0) return;
  throw new Error(
    `[sync-engine] table "${table.tableName}" writes ${clash.join(", ")}, ` +
      "which this mechanism owns. Remove them from toColumns."
  );
}

function createSyncHandle(
  storeKey: RecordStoreKey,
  table: RemoteTableSpec,
  adapter: LocalRecordStorageAdapter,
  schemaVersion: number
): SyncHandle {
  return {
    storeKey,
    table,

    async takePending(limit) {
      return adapter.readPending(limit);
    },

    async markPushed(accepted) {
      if (accepted.length === 0) return;
      const updates: StoredRecord[] = [];
      for (const ack of accepted) {
        const current = await adapter.read(ack.key);
        if (!current) continue;
        updates.push({ ...current, pending: 0, syncedAt: ack.updatedAt });
      }
      await adapter.write(updates);
    },

    async applyRemote(records) {
      let applied = 0;
      let skippedLocalNewer = 0;
      const updates: StoredRecord[] = [];
      for (const remote of records) {
        const current = await adapter.read(remote.key);
        // LAST WRITE WINS, and a local edit that has not been pushed yet is
        // treated as the later one -- it has not had its chance to argue. The
        // caller logs the skip rather than swallowing it: a local write that
        // silently loses to a remote one is the known hazard of this scheme.
        if (current?.pending === 1) {
          skippedLocalNewer += 1;
          continue;
        }
        if (current?.syncedAt && current.syncedAt >= remote.updatedAt) continue;
        updates.push({
          key: remote.key,
          data: remote.columns === null ? null : table.fromColumns(remote.columns),
          schemaVersion,
          updatedAtMs: Date.now(),
          deleted: remote.deleted,
          pending: 0,
          syncedAt: remote.updatedAt
        });
        applied += 1;
      }
      if (updates.length > 0) await adapter.write(updates);
      return { applied, skippedLocalNewer };
    },

    async getWatermark() {
      const stored = await adapter.read(WATERMARK_KEY);
      return typeof stored?.data === "string" ? stored.data : null;
    },

    async setWatermark(value) {
      await adapter.write([
        {
          key: WATERMARK_KEY,
          data: value,
          schemaVersion,
          updatedAtMs: Date.now(),
          deleted: false,
          // Never pushed: this is where THIS device got to, not a fact about
          // the account.
          pending: 0,
          syncedAt: null
        }
      ]);
    }
  };
}

export type { LocalRecordStorageAdapter };
export {
  RECORD_STORE_DB_SEGMENT,
  createIndexedDBRecordStorage,
  createMemoryRecordStorage
} from "./local-record-storage";
export * from "./sync-engine";
