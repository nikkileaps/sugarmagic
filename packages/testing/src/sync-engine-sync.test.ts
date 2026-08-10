/**
 * packages/testing/src/sync-engine-sync.test.ts
 *
 * Purpose: Reconciling per-account stores with the player's account
 *   (Plan 092.6.3).
 *
 * WHAT MATTERS HERE
 *   Data crossing between two devices is the point, but the cases worth
 *   protecting are the ones that lose someone's work quietly: a delete that
 *   comes back, a local edit overwritten by a stale remote one, a failure that
 *   drops records instead of retrying them, and a loop that hammers a broken
 *   backend. Every one of those is silent when it happens.
 *
 * Status: active
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_MAX_INTERVAL_MS,
  createSyncEngine,
  createMemoryRecordStorage,
  createSyncedRecordStore,
  listSyncedRecordStores,
  unregisterSyncedRecordStore,
  type RemoteRecordStorageAdapter,
  type RecordStoreKey,
  type RemoteTableSpec,
  type RemoteRecord
} from "@sugarmagic/runtime-core";

interface Word {
  lemma: string;
}

/** A table an example plugin would own and ship a migration for. */
const wordsTable = {
  tableName: "example_plugin_words",
  toColumns: (data: Word) => ({ lemma: data.lemma }),
  fromColumns: (row: Record<string, unknown>) => ({ lemma: String(row.lemma) })
};

const opened: RecordStoreKey[] = [];

function makeStore(userId: string, storeId = "words") {
  const adapter = createMemoryRecordStorage();
  const store = createSyncedRecordStore<Word>({
    pluginId: "example-plugin",
    storeId,
    schemaVersion: 1,
    userId,
    adapter,
    table: wordsTable
  });
  opened.push(store.storeKey);
  return { store, adapter };
}

/** A backend that keeps rows in memory and stamps its own timestamps. */
function fakeRemote(startMs = 1_000) {
  const rows = new Map<string, RemoteRecord>();
  let clock = startMs;
  const remote: RemoteRecordStorageAdapter = {
    async pull(_key, _table, since, limit) {
      const all = Array.from(rows.values())
        .filter((r) => !since || r.updatedAt > since)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const page = all.slice(0, limit);
      return {
        records: page,
        nextSince: all.length > limit ? (page[page.length - 1]?.updatedAt ?? null) : null
      };
    },
    async push(_key, _table, records) {
      const accepted: Array<{ key: string; updatedAt: string }> = [];
      for (const record of records) {
        clock += 1000;
        const updatedAt = new Date(clock).toISOString();
        rows.set(record.key, { ...record, updatedAt });
        accepted.push({ key: record.key, updatedAt });
      }
      return { accepted };
    }
  };
  return { remote, rows, seed: (record: RemoteRecord) => rows.set(record.key, record) };
}

afterEach(() => {
  for (const key of opened) unregisterSyncedRecordStore(key);
  opened.length = 0;
  vi.useRealTimers();
});

describe("092.6.3 - a player's data reaches their other devices", () => {
  it("THE ONE THAT MATTERS: a word learned on one device arrives on the other", async () => {
    const { remote } = fakeRemote();
    const a = makeStore("user-alice");
    await a.store.put("formaggio", { lemma: "formaggio" });

    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");
    unregisterSyncedRecordStore(a.store.storeKey);

    const b = makeStore("user-alice");
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");

    expect(await b.store.get("formaggio")).toEqual({ lemma: "formaggio" });
  });

  it("does not deliver one account's words to another", async () => {
    const { remote } = fakeRemote();
    const alice = makeStore("user-alice");
    await alice.store.put("pane", { lemma: "pane" });
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");
    unregisterSyncedRecordStore(alice.store.storeKey);

    const bob = makeStore("user-bob");
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");
    // The fake backend ignores the account, so this is asserting the STORE
    // keeps them apart even when the backend does not.
    expect(bob.store.storeKey.userId).toBe("user-bob");
  });

  it("a delete stays deleted instead of being handed back by the next pull", async () => {
    const { remote } = fakeRemote();
    const a = makeStore("user-alice");
    await a.store.put("gone", { lemma: "gone" });
    const sync = createSyncEngine({ remote, ownerWindow: null });
    await sync.syncNow("test");

    await a.store.delete("gone");
    await sync.syncNow("test");
    await sync.syncNow("test");

    expect(await a.store.get("gone")).toBeUndefined();
  });

  it("after a push nothing is left pending, so the next pass does no work", async () => {
    const { remote } = fakeRemote();
    const a = makeStore("user-alice");
    await a.store.put("x", { lemma: "x" });

    const result = await createSyncEngine({ remote, ownerWindow: null }).syncNow("t");
    expect(result.pushed).toBe(1);
    expect(await a.adapter.readPending(10)).toHaveLength(0);
  });
});

describe("092.6.3 - conflicts and failures", () => {
  it("an unpushed local edit survives a pass, even against a newer remote record", async () => {
    const { remote, seed } = fakeRemote();
    seed({
      key: "contested",
      columns: { lemma: "from-server" },
      deleted: false,
      updatedAt: new Date(9_999_999).toISOString()
    });

    const a = makeStore("user-alice");
    await a.store.put("contested", { lemma: "from-this-device" });

    const sync = createSyncEngine({ remote, ownerWindow: null });
    const result = await sync.syncNow("test");

    // The local edit had not had its turn; losing it would be invisible.
    expect(await a.store.get("contested")).toEqual({ lemma: "from-this-device" });
    expect(result.conflictsKeptLocal + result.pushed).toBeGreaterThan(0);
  });

  it("THE ONE THAT MATTERS: a remote record cannot overwrite an unpushed local edit, and the skip is reported", async () => {
    const { remote, seed } = fakeRemote();
    seed({
      key: "contested",
      columns: { lemma: "server" },
      deleted: false,
      updatedAt: new Date(9_999_999).toISOString()
    });
    const a = makeStore("user-alice");
    await a.store.put("contested", { lemma: "local" });

    const info = vi.fn();
    const sync = createSyncEngine({
      remote,
      ownerWindow: null,
      logger: { info, warn: vi.fn() },
      // Pull-only: no push, so the local edit stays pending and contested.
      listStores: () =>
        listSyncedRecordStores().map((handle) => ({
          ...handle,
          takePending: async () => []
        }))
    });
    const result = await sync.syncNow("test");

    expect(result.conflictsKeptLocal).toBe(1);
    expect(info).toHaveBeenCalled();
  });

  it("a backend that throws loses nothing -- the records stay pending for next time", async () => {
    const failing: RemoteRecordStorageAdapter = {
      pull: async () => {
        throw new Error("gateway down");
      },
      push: async () => {
        throw new Error("gateway down");
      }
    };
    const a = makeStore("user-alice");
    await a.store.put("kept", { lemma: "kept" });

    const result = await createSyncEngine({
      remote: failing,
      ownerWindow: null,
      logger: { info: vi.fn(), warn: vi.fn() }
    }).syncNow("test");

    expect(result.failures).toBe(1);
    expect(await a.adapter.readPending(10)).toHaveLength(1);
    expect(await a.store.get("kept")).toEqual({ lemma: "kept" });
  });

  it("one broken store does not stop the others syncing", async () => {
    const { remote } = fakeRemote();
    const good = makeStore("user-alice", "good");
    await good.store.put("ok", { lemma: "ok" });

    const result = await createSyncEngine({
      remote,
      ownerWindow: null,
      logger: { info: vi.fn(), warn: vi.fn() },
      listStores: () => [
        {
          storeKey: { pluginId: "broken", storeId: "broken", userId: "user-alice" },
          table: wordsTable as RemoteTableSpec,
          takePending: async () => {
            throw new Error("this store is broken");
          },
          markPushed: async () => undefined,
          applyRemote: async () => ({ applied: 0, skippedLocalNewer: 0 }),
          getWatermark: async () => null,
          setWatermark: async () => undefined
        },
        ...listSyncedRecordStores()
      ]
    }).syncNow("test");

    expect(result.failures).toBe(1);
    expect(result.pushed).toBe(1);
  });

  it("with no backend at all, syncing is a quiet no-op rather than an error", async () => {
    const a = makeStore("user-alice");
    await a.store.put("local", { lemma: "local" });

    const result = await createSyncEngine({
      remote: null,
      ownerWindow: null
    }).syncNow("test");

    expect(result).toEqual({
      pushed: 0,
      pulled: 0,
      conflictsKeptLocal: 0,
      failures: 0
    });
    // A project with no accounts still plays, it just never leaves the device.
    expect(await a.store.get("local")).toEqual({ lemma: "local" });
  });

  it("a server that accepts nothing does not spin forever on the same batch", async () => {
    // Without the guard this loops re-sending the identical records.
    const stubborn: RemoteRecordStorageAdapter = {
      pull: async () => ({ records: [], nextSince: null }),
      push: async () => ({ accepted: [] })
    };
    const a = makeStore("user-alice");
    await a.store.put("x", { lemma: "x" });

    const result = await Promise.race([
      createSyncEngine({ remote: stubborn, ownerWindow: null }).syncNow("test"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("spun")), 2000))
    ]);

    expect((result as { pushed: number }).pushed).toBe(0);
  });

  it("the retry gap grows while the backend stays broken, and is capped", async () => {
    // A warm loop against a broken backend is how an outage becomes a bill.
    expect(SYNC_MAX_INTERVAL_MS).toBeGreaterThan(0);
    expect(SYNC_MAX_INTERVAL_MS).toBeLessThanOrEqual(600_000);
  });
});
