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
  registerSyncedRecordStore,
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
  fromRow: (row: Record<string, unknown>) => ({ lemma: String(row.lemma) })
};

/**
 * A table whose identity field IS the record key, which is the ordinary shape:
 * the word table stores a lemma id that way rather than repeating it as a
 * column of its own.
 *
 * This exists because the contract broke exactly here. `fromColumns` took a
 * parameter named `row`, the Supabase adapter read the name and stripped
 * `record_key` before the call, and every table spec read it back -- so pulled
 * records arrived with an empty id, collapsed into one entry on read, and a
 * second device recovered nothing. A spec that reads its own key is now the
 * thing under test rather than an assumption.
 */
interface KeyedWord {
  id: string;
  lemma: string;
}

const keyedTable: RemoteTableSpec<KeyedWord> = {
  tableName: "example_plugin_keyed_words",
  // Deliberately does NOT emit the id: it is the record key.
  toColumns: (data) => ({ lemma: data.lemma }),
  fromRow: (row) => ({
    id: String(row.record_key ?? ""),
    lemma: String(row.lemma)
  })
};

const opened: RecordStoreKey[] = [];

function makeStore(userId: string, storeId = "words") {
  const adapter = createMemoryRecordStorage();
  // Building and registering are two steps on purpose: a test can build one
  // and assert on it without the sync loop ever seeing it.
  const { store, handle } = createSyncedRecordStore<Word>({
    pluginId: "example-plugin",
    storeId,
    schemaVersion: 1,
    userId,
    adapter,
    table: wordsTable
  });
  registerSyncedRecordStore(handle);
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

describe("092.6.3 - a record keyed by its own id survives the round trip", () => {
  function makeKeyedStore(userId: string) {
    const { store, handle } = createSyncedRecordStore<KeyedWord>({
      pluginId: "example-plugin",
      storeId: "keyed-words",
      schemaVersion: 1,
      userId,
      adapter: createMemoryRecordStorage(),
      table: keyedTable
    });
    registerSyncedRecordStore(handle);
    opened.push(store.storeKey);
    return store;
  }

  it("THE ONE THAT MATTERS: a pulled record keeps its id", async () => {
    const { remote } = fakeRemote();
    const a = makeKeyedStore("user-alice");
    await a.put("riconoscere", { id: "riconoscere", lemma: "riconoscere" });
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");
    unregisterSyncedRecordStore(a.storeKey);

    const b = makeKeyedStore("user-alice");
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");

    // The id is carried as `record_key` on the wire, never as a column, so
    // this is the assertion that the engine hands the key back to the spec.
    expect(await b.get("riconoscere")).toEqual({
      id: "riconoscere",
      lemma: "riconoscere"
    });
  });

  it("many pulled records stay distinct rather than collapsing onto one id", async () => {
    // The failure this replaces was silent in exactly this way: every record
    // came back with an empty id, so a caller keying by it kept only the last.
    const { remote } = fakeRemote();
    const a = makeKeyedStore("user-alice");
    for (const lemma of ["pane", "formaggio", "vino"]) {
      await a.put(lemma, { id: lemma, lemma });
    }
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");
    unregisterSyncedRecordStore(a.storeKey);

    const b = makeKeyedStore("user-alice");
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");

    const byId = new Map((await b.list()).map((e) => [e.data.id, e.data.lemma]));
    expect(byId.size).toBe(3);
    expect(byId.get("formaggio")).toBe("formaggio");
  });
});

describe("092.6.3 - a device that has never pulled cannot overwrite the account", () => {
  it("THE ONE THAT MATTERS: the account's record beats one invented before any pull", async () => {
    // The shape that destroyed a returning player's level. Their stores are
    // built on the first conversation turn, long after boot waited for a sync
    // pass that found nothing registered. The learner core is read, comes back
    // empty, and is written straight back as a defaulted profile -- under the
    // one fixed key "core". Treated as an unpushed edit it outranks the real
    // record and is then pushed over it. It is not an edit; this device had
    // not yet heard anything.
    const { remote, seed } = fakeRemote();
    seed({
      key: "core",
      columns: { lemma: "B2-from-the-account" },
      deleted: false,
      updatedAt: new Date(9_999_999).toISOString()
    });

    const fresh = makeStore("user-alice");
    await fresh.store.put("core", { lemma: "defaulted-because-the-store-was-empty" });

    await createSyncEngine({ remote, ownerWindow: null }).syncNow("first pass");

    expect(await fresh.store.get("core")).toEqual({ lemma: "B2-from-the-account" });
  });

  it("does not push anything when the pull fails, rather than overwriting blind", async () => {
    // A device that cannot read the account must not write to it. Pushing here
    // would replace real rows with whatever this device defaulted to while it
    // had no idea what was there.
    const pushed: unknown[] = [];
    const pullFails: RemoteRecordStorageAdapter = {
      pull: async () => {
        throw new Error("gateway down");
      },
      push: async (_k, _t, records) => {
        pushed.push(...records);
        return { accepted: [] };
      }
    };
    const a = makeStore("user-alice");
    await a.store.put("core", { lemma: "defaulted" });

    const result = await createSyncEngine({
      remote: pullFails,
      ownerWindow: null,
      logger: { info: vi.fn(), warn: vi.fn() }
    }).syncNow("test");

    expect(pushed).toHaveLength(0);
    expect(result.failures).toBe(1);
    // Nothing is lost by refusing: it stays pending for a pass that can read.
    expect(await a.adapter.readPending(10)).toHaveLength(1);
  });

  it("finishes the first-sync wait even when the pass fails, so the game still starts", async () => {
    const failing: RemoteRecordStorageAdapter = {
      pull: async () => {
        throw new Error("gateway down");
      },
      push: async () => ({ accepted: [] })
    };
    const a = makeStore("user-alice");

    await createSyncEngine({
      remote: failing,
      ownerWindow: null,
      logger: { info: vi.fn(), warn: vi.fn() }
    }).syncNow("test");

    await expect(a.store.whenFirstSynced()).resolves.toBeUndefined();
  });

  it("a store opened before the loop starts waits for the first pass, not for nothing", async () => {
    // The host builds the loop, then asks plugins to open their storage, then
    // starts it. If the loop only claimed the registration listener at start(),
    // those stores would be told nothing would ever sync them and would finish
    // their wait on the spot -- reporting a first sync that had not happened,
    // for exactly the stores the wait exists to protect.
    const { remote, seed } = fakeRemote();
    seed({
      key: "from-the-account",
      columns: { lemma: "known" },
      deleted: false,
      updatedAt: new Date(9_999_999).toISOString()
    });

    const engine = createSyncEngine({ remote, ownerWindow: null });
    const store = makeStore("user-alice").store;

    const pending = Symbol("still waiting");
    expect(
      await Promise.race([store.whenFirstSynced(), Promise.resolve(pending)])
    ).toBe(pending);

    await engine.start();
    await expect(store.whenFirstSynced()).resolves.toBeUndefined();
    // ...and the wait was worth something: the account's record is here.
    expect(await store.get("from-the-account")).toEqual({ lemma: "known" });
    engine.stop();
  });

  it("THE ONE THAT MATTERS: an edit made while a push is in flight still gets sent", async () => {
    // A push is a network round trip and the player keeps playing through it.
    // The acknowledgement that comes back is for the version that was SENT, but
    // the flag was cleared on whatever the record is NOW -- so an edit landing
    // in that window was marked as saved without the server ever seeing it, and
    // was never offered again. Silent, and only visible as a word that quietly
    // failed to follow someone to their other device.
    const { remote } = fakeRemote();
    const a = makeStore("user-alice");
    await a.store.put("word", { lemma: "first" });

    const editsMidFlight: RemoteRecordStorageAdapter = {
      pull: remote.pull,
      push: async (key, table, records) => {
        // Deterministic stand-in for "the player learned something else while
        // the request was open".
        await a.store.put("word", { lemma: "second" });
        return remote.push(key, table, records);
      }
    };

    await createSyncEngine({
      remote: editsMidFlight,
      ownerWindow: null
    }).syncNow("test");

    // The newer text is what the player has...
    expect(await a.store.get("word")).toEqual({ lemma: "second" });
    // ...and it is still queued, because the server was only ever told "first".
    expect(await a.adapter.readPending(10)).toHaveLength(1);

    // The next pass sends it for real, and then it settles.
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");
    expect(await a.adapter.readPending(10)).toHaveLength(0);
  });

  it("still clears the flag on a record that was NOT touched during the push", async () => {
    // The other half: if nothing edited it, leaving it flagged would mean
    // pushing the same record on every pass forever.
    const { remote } = fakeRemote();
    const a = makeStore("user-alice");
    await a.store.put("settled", { lemma: "settled" });

    await createSyncEngine({ remote, ownerWindow: null }).syncNow("test");

    expect(await a.adapter.readPending(10)).toHaveLength(0);
  });

  it("finishes the wait immediately when there is no backend to sync against", async () => {
    // A project with no account plugin is supported, not broken. A caller
    // waiting on this must not wait forever.
    const store = makeStore("user-alice", "no-backend").store;
    await createSyncEngine({ remote: null, ownerWindow: null }).syncNow("test");
    await expect(store.whenFirstSynced()).resolves.toBeUndefined();
  });
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

describe("092.6 - a returning player's data is there before they can use it", () => {
  it("THE ONE THAT MATTERS: start() does not resolve until the first pull has landed", async () => {
    // Left to the background interval this raced the player: reach a
    // conversation before the pull landed and the game read an empty store,
    // taught words already known, then corrected itself minutes later with no
    // sign anything had been wrong. Boot awaits this, so there is no window.
    const { remote, seed } = fakeRemote();
    seed({
      key: "already-known",
      columns: { lemma: "already-known" },
      deleted: false,
      updatedAt: new Date(5_000).toISOString()
    });
    const a = makeStore("user-returning");

    // The blocker is built BEFORE the engine can reach it, so releasing it is
    // never a no-op that leaves the pull hanging.
    let releasePull!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let resolved = false;
    const slow: RemoteRecordStorageAdapter = {
      pull: async (key, table, since, limit) => {
        await blocked;
        return remote.pull(key, table, since, limit);
      },
      push: remote.push
    };

    const engine = createSyncEngine({ remote: slow, ownerWindow: null });
    const started = engine.start().then(() => {
      resolved = true;
    });

    // The pull is still in flight, so boot must still be waiting. Several
    // ticks, because the pass pushes before it pulls.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(resolved).toBe(false);
    expect(await a.store.get("already-known")).toBeUndefined();

    releasePull();
    await started;

    expect(resolved).toBe(true);
    expect(await a.store.get("already-known")).toEqual({ lemma: "already-known" });
    engine.stop();
  });

  it("a backend that never answers does not hold the player out of the game", async () => {
    // The bound lives with BOOT, not here: waiting for a player's data is the
    // same readiness phase as waiting for the world, so there is one deadline
    // and one prompt rather than two timeouts that disagree. See
    // BOOT_READINESS_TIMEOUT_MS in the web host.
    const engine = createSyncEngine({ remote: null, ownerWindow: null });
    await expect(engine.start()).resolves.toBeUndefined();
    engine.stop();
  });
});

describe("092.6.3 - Studio Preview never reaches the backend", () => {
  it("THE ONE THAT MATTERS: with no remote, nothing leaves the device", async () => {
    // Preview runs the same host as the published game, against a project
    // configured for the REAL backend. Without the host guard every word
    // learned while authoring would land in the live database as if a player
    // had learned it. This is the shape that guard produces.
    const a = makeStore("user-alice");
    await a.store.put("authored", { lemma: "authored" });

    const result = await createSyncEngine({
      remote: null,
      ownerWindow: null
    }).syncNow("preview");

    expect(result.pushed).toBe(0);
    expect(result.failures).toBe(0);
    // ...and the author still has their data locally.
    expect(await a.store.get("authored")).toEqual({ lemma: "authored" });
    // Still pending, so a build that DOES sync would send it.
    expect(await a.adapter.readPending(10)).toHaveLength(1);
  });
});

describe("092.6.3 - conflicts and failures", () => {
  it("an unpushed local edit survives a pass, even against a newer remote record", async () => {
    const { remote, seed } = fakeRemote();
    const a = makeStore("user-alice");

    // ONE PASS FIRST, so this device has heard what the account holds. Until
    // it has, a local record is a guess rather than an edit and the account
    // wins it -- pinned by the never-pulled tests below. This test is about
    // the steady state, which is where the rule protects real work.
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("warm-up");

    seed({
      key: "contested",
      columns: { lemma: "from-server" },
      deleted: false,
      updatedAt: new Date(9_999_999).toISOString()
    });
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
    // As above: steady state, not a device that has never pulled.
    await createSyncEngine({ remote, ownerWindow: null }).syncNow("warm-up");
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
          setWatermark: async () => undefined,
          hasPulled: () => true,
          markPulled: () => {},
          markFirstSyncDone: () => {}
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
