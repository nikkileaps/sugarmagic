/**
 * packages/testing/src/sync-engine-store.test.ts
 *
 * Purpose: The general per-account store any plugin can use (Plan 092.6.2).
 *
 * WHAT THIS IS PROTECTING
 *   Four hand-rolled versions of this shipped before it existed, and three of
 *   them keyed on something that was not the account. The point of one
 *   mechanism is that the next plugin inherits the answers instead of
 *   re-deriving them -- so the tests here are mostly about the answers being
 *   inherited: an unscoped store refuses to open, a local store is invisible
 *   to sync, a tombstone survives, and no plugin is named in the source.
 *
 * Status: active
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createLocalRecordStore,
  createMemoryRecordStorage,
  createSyncedRecordStore,
  listSyncedRecordStores,
  unregisterSyncedRecordStore,
  type RecordStoreKey,
  type RecordStoreSpec
} from "@sugarmagic/runtime-core";

interface Word {
  lemma: string;
  strength: number;
}

function spec<TData>(
  over: Partial<RecordStoreSpec<TData>> = {}
): RecordStoreSpec<TData> {
  return {
    pluginId: "example-plugin",
    storeId: "words",
    schemaVersion: 1,
    userId: "user-alice",
    adapter: createMemoryRecordStorage(),
    ...over
  };
}


/** A table an example plugin would own and ship a migration for. */
const wordsTable = {
  tableName: "example_plugin_words",
  toColumns: (data: Word) => ({ lemma: data.lemma, strength: data.strength }),
  fromColumns: (row: Record<string, unknown>) => ({
    lemma: String(row.lemma),
    strength: Number(row.strength)
  })
};

const registered = new Set<RecordStoreKey>();
function trackForCleanup(key: RecordStoreKey): RecordStoreKey {
  registered.add(key);
  return key;
}

afterEach(() => {
  for (const key of registered) unregisterSyncedRecordStore(key);
  registered.clear();
});

describe("092.6.2 - one store any plugin can use", () => {
  it("THE ONE THAT MATTERS: reads and writes go to the local copy", async () => {
    const store = createLocalRecordStore<Word>(spec<Word>());
    await store.put("formaggio", { lemma: "formaggio", strength: 1 });
    expect(await store.get("formaggio")).toEqual({ lemma: "formaggio", strength: 1 });
  });

  it("refuses to open without an account, rather than sharing one browser's data", () => {
    // The Plan 092.6.1 bug, generalised: storage opened without an account is
    // storage everyone using the browser shares.
    expect(() =>
      createLocalRecordStore({
        pluginId: "example-plugin",
        storeId: "words",
        schemaVersion: 1,
        adapter: createMemoryRecordStorage()
        // no userId, and no signed-in account in this environment
      })
    ).toThrow(/before an account resolved/);
  });

  it("two accounts do not see each other, even in the same plugin's store", async () => {
    const alice = createLocalRecordStore<Word>(spec<Word>({ userId: "user-alice" }));
    const bob = createLocalRecordStore<Word>(
      spec<Word>({ userId: "user-bob", adapter: createMemoryRecordStorage() })
    );
    await alice.put("pane", { lemma: "pane", strength: 1 });
    expect(await bob.get("pane")).toBeUndefined();
    expect(alice.storeKey.userId).not.toBe(bob.storeKey.userId);
  });
});

describe("092.6.2 - synced and local-only are different things", () => {
  it("THE ONE THAT MATTERS: a local store is invisible to the sync loop", () => {
    createLocalRecordStore<Word>(spec<Word>());
    expect(listSyncedRecordStores()).toHaveLength(0);
  });

  it("a synced store registers itself, so declaring one IS the wiring", () => {
    const store = createSyncedRecordStore<Word>({ table: wordsTable, ...spec<Word>() });
    trackForCleanup(store.storeKey);
    expect(listSyncedRecordStores()).toHaveLength(1);
    expect(listSyncedRecordStores()[0]!.storeKey.storeId).toBe("words");
  });

  it("only a synced store marks a write as needing to be pushed", async () => {
    const localAdapter = createMemoryRecordStorage();
    const local = createLocalRecordStore<Word>(spec<Word>({ adapter: localAdapter }));
    await local.put("a", { lemma: "a", strength: 1 });
    expect(await localAdapter.readPending(10)).toHaveLength(0);

    const syncedAdapter = createMemoryRecordStorage();
    const synced = createSyncedRecordStore<Word>({
      table: wordsTable,
      ...spec<Word>({ adapter: syncedAdapter, storeId: "synced-words" })
    });
    trackForCleanup(synced.storeKey);
    await synced.put("b", { lemma: "b", strength: 1 });
    expect(await syncedAdapter.readPending(10)).toHaveLength(1);
  });
});

describe("092.6.2 - the store's own bookkeeping stays out of the way", () => {
  it("a sync watermark is never handed back as if it were a record", async () => {
    // It lives in the same keyspace, so a caller listing their words would
    // otherwise be handed the store's internal bookkeeping as one of them.
    const adapter = createMemoryRecordStorage();
    const store = createSyncedRecordStore<Word>({ table: wordsTable, ...spec<Word>({ adapter }) });
    trackForCleanup(store.storeKey);

    const handle = listSyncedRecordStores().find(
      (h) => h.storeKey.storeId === store.storeKey.storeId
    );
    await handle!.setWatermark("2026-01-01T00:00:00.000Z");
    await store.put("formaggio", { lemma: "formaggio", strength: 1 });

    expect((await store.list()).map((r) => r.key)).toEqual(["formaggio"]);
    expect(await store.count()).toBe(1);
    // ...and it is still there for the sync loop.
    expect(await handle!.getWatermark()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a record whose key starts with a space is a NORMAL record", async () => {
    // The reserved prefix is U+0000, not a space. It was written as a literal
    // space once, which would have silently swallowed any key beginning with
    // one.
    const store = createSyncedRecordStore<Word>({
      table: wordsTable,
      ...spec<Word>({ adapter: createMemoryRecordStorage(), storeId: "spacey" })
    });
    trackForCleanup(store.storeKey);
    await store.put(" leading space", { lemma: "x", strength: 1 });
    expect((await store.list()).map((r) => r.key)).toEqual([" leading space"]);
  });
});

describe("092.6.2 - deletes and migrations", () => {
  it("a delete leaves a tombstone, so it cannot be undone by the next pull", async () => {
    const adapter = createMemoryRecordStorage();
    const store = createSyncedRecordStore<Word>({ table: wordsTable, ...spec<Word>({ adapter }) });
    trackForCleanup(store.storeKey);

    await store.put("gone", { lemma: "gone", strength: 1 });
    await store.delete("gone");

    expect(await store.get("gone")).toBeUndefined();
    // Removing the row outright would let the server hand it straight back.
    const stored = await adapter.read("gone");
    expect(stored?.deleted).toBe(true);
  });

  it("an old record is upgraded on read, without every caller remembering to", async () => {
    const adapter = createMemoryRecordStorage();
    await adapter.write([
      {
        key: "old",
        data: { lemma: "old" },
        schemaVersion: 1,
        updatedAtMs: 1,
        deleted: false,
        pending: 0,
        syncedAt: null
      }
    ]);
    const store = createLocalRecordStore<Word>(
      spec<Word>({
        adapter,
        schemaVersion: 2,
        migrate: (data: unknown, from: number) =>
          from < 2 ? { ...(data as Word), strength: 0 } : (data as Word)
      })
    );
    expect(await store.get("old")).toEqual({ lemma: "old", strength: 0 });
  });

  it("a record that cannot be upgraded is dropped, not handed back malformed", async () => {
    const adapter = createMemoryRecordStorage();
    await adapter.write([
      {
        key: "broken",
        data: { nonsense: true },
        schemaVersion: 1,
        updatedAtMs: 1,
        deleted: false,
        pending: 0,
        syncedAt: null
      }
    ]);
    const store = createLocalRecordStore<Word>(
      spec<Word>({ adapter, schemaVersion: 2, migrate: () => null })
    );
    expect(await store.get("broken")).toBeUndefined();
  });

  it("an old record with NO migration is dropped rather than trusted", async () => {
    const adapter = createMemoryRecordStorage();
    await adapter.write([
      {
        key: "old",
        data: { lemma: "old" },
        schemaVersion: 1,
        updatedAtMs: 1,
        deleted: false,
        pending: 0,
        syncedAt: null
      }
    ]);
    const store = createLocalRecordStore<Word>(spec<Word>({ adapter, schemaVersion: 2 }));
    expect(await store.get("old")).toBeUndefined();
  });
});

describe("092.6.2 - the mechanism names no plugin", () => {
  // The host already drifted the other way: runtimeHost.ts imports one
  // specific plugin's id and branches on it. A rule with no enforcer is a
  // rule that lasts until someone is in a hurry. Same guard Plan 092.1 put on
  // the asset collector.
  const PLUGIN_NAMES = [
    "sugarlang",
    "sugaragent",
    "sugarprofile",
    "sugardeploy",
    "fireflies"
  ];
  const files = ["index.ts", "local-record-storage.ts", "sync-engine.ts"];

  for (const file of files) {
    it(`sync-engine/${file} contains no plugin name`, () => {
      const source = readFileSync(
        join(__dirname, "../../runtime-core/src/sync-engine", file),
        "utf8"
      ).toLowerCase();
      for (const name of PLUGIN_NAMES) {
        expect(source).not.toContain(name);
      }
    });
  }
});
