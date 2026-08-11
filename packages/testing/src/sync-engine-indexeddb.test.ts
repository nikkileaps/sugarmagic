/**
 * packages/testing/src/sync-engine-indexeddb.test.ts
 *
 * Purpose: Exercises the IndexedDB adapter an account store actually uses in a
 *   browser (Plan 092.6.2).
 *
 * WHY IT EXISTS
 *   Every other test in this area injects the memory adapter, so the real one
 *   -- cursor paging, the pending index, the reserved-key range -- had never
 *   been executed by anything before this file. Those are exactly the parts
 *   that cannot be reasoned about from the source.
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import {
  createIndexedDBRecordStorage,
  type RecordStoreKey,
  type StoredRecord
} from "@sugarmagic/runtime-core";

import { registerActiveGameId } from "@sugarmagic/runtime-core";

// Storage on a player's device is named for the game they are playing, and the
// namer refuses to build a name without one -- a database with no game in its
// name is shared by every game on the origin. The host registers this from the
// boot payload in a real run.
beforeEach(() => registerActiveGameId("test-game"));

let n = 0;
function adapter(userId = `user-${n++}`) {
  const key: RecordStoreKey = {
    pluginId: "example-plugin",
    storeId: "words",
    userId
  };
  return createIndexedDBRecordStorage(key);
}

function record(
  key: string,
  over: Partial<StoredRecord> = {}
): StoredRecord {
  return {
    key,
    data: { lemma: key },
    schemaVersion: 1,
    updatedAtMs: 1,
    deleted: false,
    pending: 0,
    syncedAt: null,
    ...over
  };
}

describe("092.6.2 - the real IndexedDB adapter", () => {
  it("THE ONE THAT MATTERS: writes survive a reopen", async () => {
    const first = adapter("user-persist");
    await first.write([record("formaggio")]);
    await first.close?.();

    const second = adapter("user-persist");
    expect((await second.read("formaggio"))?.data).toEqual({ lemma: "formaggio" });
    await second.close?.();
  });

  it("pages through more records than one page holds, without repeating or dropping", async () => {
    const store = adapter();
    const keys = Array.from({ length: 25 }, (_, i) => `w${String(i).padStart(3, "0")}`);
    await store.write(keys.map((k) => record(k)));

    const seen: string[] = [];
    let cursor = "";
    for (let guard = 0; guard < 20; guard++) {
      const page = await store.readPage(cursor, 10);
      seen.push(...page.records.map((r) => r.key));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(keys);
    expect(new Set(seen).size).toBe(keys.length);
    await store.close?.();
  });

  it("finds only the records that still need pushing", async () => {
    const store = adapter();
    await store.write([
      record("clean", { pending: 0 }),
      record("dirty-a", { pending: 1 }),
      record("dirty-b", { pending: 1 })
    ]);

    const pending = await store.readPending(100);
    expect(pending.map((r) => r.key).sort()).toEqual(["dirty-a", "dirty-b"]);
    await store.close?.();
  });

  it("stops asking once a record has been pushed", async () => {
    const store = adapter();
    await store.write([record("x", { pending: 1 })]);
    expect(await store.readPending(10)).toHaveLength(1);

    await store.write([record("x", { pending: 0, syncedAt: "2026-01-01T00:00:00Z" })]);
    expect(await store.readPending(10)).toHaveLength(0);
    await store.close?.();
  });

  it("two accounts get separate databases, so neither can read the other", async () => {
    const alice = adapter("user-alice-idb");
    const bob = adapter("user-bob-idb");
    await alice.write([record("secret")]);

    expect(await bob.read("secret")).toBeUndefined();
    await alice.close?.();
    await bob.close?.();
  });

  it("clearing removes everything", async () => {
    const store = adapter();
    await store.write([record("a"), record("b")]);
    await store.removeAll();
    expect((await store.readPage("", 100)).records).toHaveLength(0);
    await store.close?.();
  });

  it("reopens cleanly after close, rather than failing on the next call", async () => {
    const store = adapter();
    await store.write([record("a")]);
    await store.close?.();
    expect((await store.read("a"))?.key).toBe("a");
    await store.close?.();
  });
});
