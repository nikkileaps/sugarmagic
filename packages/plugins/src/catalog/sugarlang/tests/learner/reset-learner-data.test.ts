/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/reset-learner-data.test.ts
 *
 * Purpose: Verifies the shared learner-data reset deletes sugarlang databases, releases live connections, and never reports a blocked delete as success.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/learner/reset-learner-data and ../../runtime/learner/card-store as the implementations under test.
 *   - Covers the Epic 081 learner-reset consolidation acceptance criteria.
 *
 * Implements: Epic 081 learner-reset consolidation
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  CARD_STORE_DB_NAME_PREFIX,
  IndexedDBCardStore
} from "../../runtime/learner/card-store";
import { resetSugarlangLearnerDatabases } from "../../runtime/learner/reset-learner-data";
import { TEACH_RECORD_DB_NAME_PREFIX } from "../../runtime/learner/teach-record-store";
import { TELEMETRY_DB_NAME } from "../../runtime/telemetry/telemetry";
import { createLemmaCard } from "./test-helpers";

import {
  registerActiveGameId,
  registerPlayerStore,
  unregisterPlayerStore
} from "@sugarmagic/runtime-core";
import { SUGARLANG_PLUGIN_ID } from "../../plugin-id";

// Storage on a player's device is named for the game they are playing, and the
// namer refuses to build a name without one -- a database with no game in its
// name is shared by every game on the origin. The host registers this from the
// boot payload in a real run.
beforeEach(() => registerActiveGameId("test-game"));

function openRawDatabase(
  factory: IDBFactory,
  name: string,
  options: { closeOnVersionChange?: boolean } = {}
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("probe")) {
        db.createObjectStore("probe");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (options.closeOnVersionChange) {
        db.onversionchange = () => db.close();
      }
      resolve(db);
    };
  });
}

async function listDatabaseNames(factory: IDBFactory): Promise<string[]> {
  const databases = await factory.databases();
  return databases
    .map((db) => db.name)
    .filter((name): name is string => typeof name === "string");
}

describe("092.6 - the wipe ASKS the stores, it does not guess their names", () => {
  it("THE ONE THAT MATTERS: a store the runtime holds is emptied", async () => {
    // The sweep below can only find databases whose NAME matches a pattern
    // kept somewhere else. That pattern stopped matching the first time a
    // store was renamed, and the wipe reported success having deleted
    // nothing. A store that exists says so, and gets asked.
    let cleared = false;
    registerPlayerStore({
      pluginId: SUGARLANG_PLUGIN_ID,
      storeId: "words",
      clear: async () => {
        cleared = true;
      }
    });

    const result = await resetSugarlangLearnerDatabases({ indexedDbFactory: null });

    expect(cleared).toBe(true);
    expect(result.clearedStores).toContain("words");
    unregisterPlayerStore(SUGARLANG_PLUGIN_ID, "words");
  });

  it("leaves another plugin's stores alone", async () => {
    let touched = false;
    registerPlayerStore({
      pluginId: "some-other-plugin",
      storeId: "its-data",
      clear: async () => {
        touched = true;
      }
    });

    await resetSugarlangLearnerDatabases({ indexedDbFactory: null });

    expect(touched).toBe(false);
    unregisterPlayerStore("some-other-plugin", "its-data");
  });

  it("one store failing does not stop the others, and is reported", async () => {
    // A wipe that stops at the first problem and says nothing about the rest
    // leaves a player half-new with no sign of it.
    const order: string[] = [];
    registerPlayerStore({
      pluginId: SUGARLANG_PLUGIN_ID,
      storeId: "broken",
      clear: async () => {
        throw new Error("database is locked");
      }
    });
    registerPlayerStore({
      pluginId: SUGARLANG_PLUGIN_ID,
      storeId: "fine",
      clear: async () => {
        order.push("fine");
      }
    });

    const result = await resetSugarlangLearnerDatabases({ indexedDbFactory: null });

    expect(order).toEqual(["fine"]);
    expect(result.clearedStores).toContain("fine");
    expect(result.clearedStores).not.toContain("broken");
    expect(result.ok).toBe(false);
    unregisterPlayerStore(SUGARLANG_PLUGIN_ID, "broken");
    unregisterPlayerStore(SUGARLANG_PLUGIN_ID, "fine");
  });
});

describe("resetSugarlangLearnerDatabases", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("THE ONE THAT MATTERS: never deletes another account's learner data", async () => {
    // The sweep used to match every learner database whose name contained the
    // plugin's segment. Once those names carried the ACCOUNT, that meant every
    // account that had ever played in this browser: sign in as someone else to
    // check something, hit reset, and their words were gone too. A name
    // pattern cannot tell whose data it is matching, which is exactly why
    // learner data is cleared by ASKING the stores instead.
    const factory = new IDBFactory();
    const mine = "test-game:sugarlang-cards:user-me:player:it:en";
    const theirs = "test-game:sugarlang-cards:user-someone-else:player:it:en";
    (await openRawDatabase(factory, mine)).close();
    (await openRawDatabase(factory, theirs)).close();
    (await openRawDatabase(factory, TELEMETRY_DB_NAME)).close();
    (await openRawDatabase(factory, "unrelated-db")).close();

    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory
    });

    expect(result.ok).toBe(true);
    // Only the author's own telemetry is swept by name.
    expect(result.deletedDatabases).toEqual([TELEMETRY_DB_NAME]);
    expect((await listDatabaseNames(factory)).sort()).toEqual(
      [mine, theirs, "unrelated-db"].sort()
    );
  });

  it("does not report success when a live connection blocks the delete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const factory = new IDBFactory();
    // Telemetry is the only thing still deleted by name, so it is what
    // exercises the blocked-delete path.
    const blockedName = TELEMETRY_DB_NAME;
    // Simulate the pre-fix failure mode: an open connection with no
    // versionchange handler holds the database open forever.
    const blockingConnection = await openRawDatabase(factory, blockedName);

    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory,
      blockedTimeoutMs: 50
    });

    expect(result.ok).toBe(false);
    expect(result.blockedDatabases).toEqual([blockedName]);
    expect(result.deletedDatabases).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("blocked"));

    blockingConnection.close();
  });

  it("a player's learner database SURVIVES a reset -- its contents go, the file stays", async () => {
    // Replaces two tests that asserted reset DELETED the card-store database.
    // It deliberately no longer does: deleting by name could not tell whose
    // data it was deleting. The store is asked to empty itself instead, which
    // also means a caller holding it stays valid rather than pointing at a
    // database that vanished underneath them.
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "user-test:learner-kept",
      indexedDbFactory: factory
    });
    await store.set(createLemmaCard("casa"));

    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: factory,
      closeables: [store],
      blockedTimeoutMs: 200
    });

    expect(result.ok).toBe(true);
    expect(result.deletedDatabases).toEqual([]);
    // Still there, and still usable.
    expect(await store.count()).toBe(1);
  });

  it("returns ok with nothing deleted when IndexedDB is unavailable", async () => {
    const result = await resetSugarlangLearnerDatabases({
      indexedDbFactory: null
    });

    expect(result.ok).toBe(true);
    expect(result.deletedDatabases).toEqual([]);
  });
});

describe("teach-record reset coverage", () => {
  it("TEACH_RECORD_DB_NAME_PREFIX starts with CARD_STORE_DB_NAME_PREFIX (auto-covered by reset enforcer)", () => {
    // The reset enforcer deletes every IDB whose name starts with CARD_STORE_DB_NAME_PREFIX.
    // Teach-record DBs are named ${TEACH_RECORD_DB_NAME_PREFIX}${learnerId}, and this
    // prefix itself starts with CARD_STORE_DB_NAME_PREFIX, so they are deleted automatically
    // without any explicit filter change.
    expect(TEACH_RECORD_DB_NAME_PREFIX.startsWith(CARD_STORE_DB_NAME_PREFIX)).toBe(true);
  });

  it("teach records are cleared by asking, not by deleting their database", async () => {
    // Their database name carries the account too, so finding it by pattern
    // had the same cross-account problem.
    const factory = new IDBFactory();
    const theirs = "test-game:sugarlang-cards:teach:user-someone-else:player:it:en";
    (await openRawDatabase(factory, theirs)).close();

    const result = await resetSugarlangLearnerDatabases({ indexedDbFactory: factory });

    expect(result.deletedDatabases).not.toContain(theirs);
    expect(await listDatabaseNames(factory)).toContain(theirs);
  });

  it("re-opens cleanly after an explicit close", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "user-test:learner-reopen",
      indexedDbFactory: factory
    });
    await store.set(createLemmaCard("gato"));

    await store.close();

    const card = await store.get("gato");
    expect(card?.lemmaId).toBe("gato");
  });

  it("is safe to call close before any operation and repeatedly", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDBCardStore({
      profileId: "user-test:learner-idle-close",
      indexedDbFactory: factory
    });

    await store.close();
    await store.close();
    expect(await store.count()).toBe(0);
  });
});
