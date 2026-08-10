/**
 * packages/testing/src/account-data-store.test.ts
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
  createLocalAccountStore,
  createMemoryAccountBacking,
  createSyncedAccountStore,
  listSyncedAccountStores,
  unregisterSyncedAccountStore,
  type AccountStoreKey,
  type AccountStoreSpec
} from "@sugarmagic/runtime-core";

interface Word {
  lemma: string;
  strength: number;
}

function spec<TData>(
  over: Partial<AccountStoreSpec<TData>> = {}
): AccountStoreSpec<TData> {
  return {
    pluginId: "example-plugin",
    storeId: "words",
    schemaVersion: 1,
    userId: "user-alice",
    backing: createMemoryAccountBacking(),
    ...over
  };
}

const registered = new Set<AccountStoreKey>();
function trackForCleanup(key: AccountStoreKey): AccountStoreKey {
  registered.add(key);
  return key;
}

afterEach(() => {
  for (const key of registered) unregisterSyncedAccountStore(key);
  registered.clear();
});

describe("092.6.2 - one store any plugin can use", () => {
  it("THE ONE THAT MATTERS: reads and writes go to the local copy", async () => {
    const store = createLocalAccountStore<Word>(spec<Word>());
    await store.put("formaggio", { lemma: "formaggio", strength: 1 });
    expect(await store.get("formaggio")).toEqual({ lemma: "formaggio", strength: 1 });
  });

  it("refuses to open without an account, rather than sharing one browser's data", () => {
    // The Plan 092.6.1 bug, generalised: storage opened without an account is
    // storage everyone using the browser shares.
    expect(() =>
      createLocalAccountStore({
        pluginId: "example-plugin",
        storeId: "words",
        schemaVersion: 1,
        backing: createMemoryAccountBacking()
        // no userId, and no signed-in account in this environment
      })
    ).toThrow(/before an account resolved/);
  });

  it("two accounts do not see each other, even in the same plugin's store", async () => {
    const alice = createLocalAccountStore<Word>(spec<Word>({ userId: "user-alice" }));
    const bob = createLocalAccountStore<Word>(
      spec<Word>({ userId: "user-bob", backing: createMemoryAccountBacking() })
    );
    await alice.put("pane", { lemma: "pane", strength: 1 });
    expect(await bob.get("pane")).toBeUndefined();
    expect(alice.storeKey.userId).not.toBe(bob.storeKey.userId);
  });
});

describe("092.6.2 - synced and local-only are different things", () => {
  it("THE ONE THAT MATTERS: a local store is invisible to the sync loop", () => {
    createLocalAccountStore<Word>(spec<Word>());
    expect(listSyncedAccountStores()).toHaveLength(0);
  });

  it("a synced store registers itself, so declaring one IS the wiring", () => {
    const store = createSyncedAccountStore<Word>(spec<Word>());
    trackForCleanup(store.storeKey);
    expect(listSyncedAccountStores()).toHaveLength(1);
    expect(listSyncedAccountStores()[0]!.storeKey.storeId).toBe("words");
  });

  it("only a synced store marks a write as needing to be pushed", async () => {
    const localBacking = createMemoryAccountBacking();
    const local = createLocalAccountStore<Word>(spec<Word>({ backing: localBacking }));
    await local.put("a", { lemma: "a", strength: 1 });
    expect(await localBacking.readPending(10)).toHaveLength(0);

    const syncedBacking = createMemoryAccountBacking();
    const synced = createSyncedAccountStore<Word>(
      spec<Word>({ backing: syncedBacking, storeId: "synced-words" })
    );
    trackForCleanup(synced.storeKey);
    await synced.put("b", { lemma: "b", strength: 1 });
    expect(await syncedBacking.readPending(10)).toHaveLength(1);
  });
});

describe("092.6.2 - deletes and migrations", () => {
  it("a delete leaves a tombstone, so it cannot be undone by the next pull", async () => {
    const backing = createMemoryAccountBacking();
    const store = createSyncedAccountStore<Word>(spec<Word>({ backing }));
    trackForCleanup(store.storeKey);

    await store.put("gone", { lemma: "gone", strength: 1 });
    await store.delete("gone");

    expect(await store.get("gone")).toBeUndefined();
    // Removing the row outright would let the server hand it straight back.
    const stored = await backing.read("gone");
    expect(stored?.deleted).toBe(true);
  });

  it("an old record is upgraded on read, without every caller remembering to", async () => {
    const backing = createMemoryAccountBacking();
    await backing.write([
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
    const store = createLocalAccountStore<Word>(
      spec<Word>({
        backing,
        schemaVersion: 2,
        migrate: (data: unknown, from: number) =>
          from < 2 ? { ...(data as Word), strength: 0 } : (data as Word)
      })
    );
    expect(await store.get("old")).toEqual({ lemma: "old", strength: 0 });
  });

  it("a record that cannot be upgraded is dropped, not handed back malformed", async () => {
    const backing = createMemoryAccountBacking();
    await backing.write([
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
    const store = createLocalAccountStore<Word>(
      spec<Word>({ backing, schemaVersion: 2, migrate: () => null })
    );
    expect(await store.get("broken")).toBeUndefined();
  });

  it("an old record with NO migration is dropped rather than trusted", async () => {
    const backing = createMemoryAccountBacking();
    await backing.write([
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
    const store = createLocalAccountStore<Word>(spec<Word>({ backing, schemaVersion: 2 }));
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
  const files = ["index.ts", "backing.ts"];

  for (const file of files) {
    it(`account-data/${file} contains no plugin name`, () => {
      const source = readFileSync(
        join(__dirname, "../../runtime-core/src/account-data", file),
        "utf8"
      ).toLowerCase();
      for (const name of PLUGIN_NAMES) {
        expect(source).not.toContain(name);
      }
    });
  }
});
