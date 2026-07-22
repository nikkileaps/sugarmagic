/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/npc-memory-store.test.ts
 *
 * Purpose: Verifies the plugin-owned NPC memory store (Plan 073
 * §073.1): keying isolates NPC / playthrough / user; the two-phase
 * write (deterministic + async summary) behaves; operations serialize
 * so a load observes an in-flight merge; a stale summary is rejected
 * by the monotonic counter; older/partial records migrate on read.
 * IndexedDB durability is smoke-tested via fake-indexeddb.
 *
 * Implements: Plan 073 §073.1 tests
 *
 * Status: active
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  InMemoryNpcMemoryBackend,
  NpcMemoryStore,
  migrateNpcMemoryRecord,
  type NpcMemoryBackend,
  type NpcMemoryRecord
} from "./npc-memory-store";

const USER = "user-1";
const PLAY_A = "play-A";
const PLAY_B = "play-B";
const FINNICK = "npc.finnick";
const HORACE = "npc.horace";

function storeOn(
  backend: NpcMemoryBackend,
  overrides: { userId?: string; playthroughId?: string } = {}
): NpcMemoryStore {
  return new NpcMemoryStore({
    userId: overrides.userId ?? USER,
    playthroughId: overrides.playthroughId ?? PLAY_A,
    backend
  });
}

describe("NpcMemoryStore keying", () => {
  it("isolates records per NPC", async () => {
    const store = storeOn(new InMemoryNpcMemoryBackend());
    await store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "hi finnick"
    });

    const finnick = await store.load(FINNICK);
    const horace = await store.load(HORACE);

    expect(finnick?.metCount).toBe(1);
    expect(horace).toBeNull();
  });

  it("isolates records per playthrough (New Game forgets)", async () => {
    const backend = new InMemoryNpcMemoryBackend();
    const playA = storeOn(backend, { playthroughId: PLAY_A });
    await playA.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "we have met"
    });

    // A New Game mints a new playthroughId -> a fresh store keys miss
    // the prior playthrough's record.
    const playB = storeOn(backend, { playthroughId: PLAY_B });
    expect(await playB.load(FINNICK)).toBeNull();
    // The prior playthrough is still intact on its own key.
    expect((await playA.load(FINNICK))?.metCount).toBe(1);
  });

  it("isolates records per user", async () => {
    const backend = new InMemoryNpcMemoryBackend();
    const userOne = storeOn(backend, { userId: "user-1" });
    await userOne.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "user one talked"
    });

    const userTwo = storeOn(backend, { userId: "user-2" });
    expect(await userTwo.load(FINNICK)).toBeNull();
  });

  it("throws when identity is not resolved", () => {
    expect(
      () => new NpcMemoryStore({ userId: null, playthroughId: PLAY_A })
    ).toThrow(/userId and/i);
    expect(
      () => new NpcMemoryStore({ userId: USER, playthroughId: null })
    ).toThrow(/playthroughId/i);
  });
});

describe("NpcMemoryStore deterministic merge", () => {
  it("bumps metCount + conversationCounter and truncates the last exchange", async () => {
    const store = new NpcMemoryStore({
      userId: USER,
      playthroughId: PLAY_A,
      backend: new InMemoryNpcMemoryBackend(),
      lastExchangeMaxChars: 10
    });

    const first = await store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "0123456789ABCDEF"
    });
    expect(first.conversationCounter).toBe(1);

    const second = await store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "again"
    });
    expect(second.conversationCounter).toBe(2);

    const record = await store.load(FINNICK);
    expect(record?.metCount).toBe(2);
    expect(record?.conversationCounter).toBe(2);
    expect(record?.lastExchange).toBe("again");
  });

  it("truncates the last exchange to the cap at write time", async () => {
    const store = new NpcMemoryStore({
      userId: USER,
      playthroughId: PLAY_A,
      backend: new InMemoryNpcMemoryBackend(),
      lastExchangeMaxChars: 10
    });
    await store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "0123456789ABCDEF"
    });
    const record = await store.load(FINNICK);
    expect(record?.lastExchange).toBe("0123456789");
  });
});

describe("NpcMemoryStore summary merge + staleness gate", () => {
  it("applies only the fields the summary delta carries", async () => {
    const store = storeOn(new InMemoryNpcMemoryBackend());
    await store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "hello"
    });

    const applied = await store.mergeSummary(
      {
        npcDefinitionId: FINNICK,
        relationshipSummary: "warming up",
        salientFacts: ["likes cheese"]
      },
      1
    );
    expect(applied).toBe(true);

    const record = await store.load(FINNICK);
    expect(record?.relationshipSummary).toBe("warming up");
    expect(record?.salientFacts).toEqual(["likes cheese"]);
    // Untouched fields keep their prior values.
    expect(record?.promises).toEqual([]);
    expect(record?.lastExchange).toBe("hello");
    expect(record?.summaryCounter).toBe(1);
  });

  it("rejects a summary from an earlier conversation than one already applied", async () => {
    const store = storeOn(new InMemoryNpcMemoryBackend());
    await store.mergeDeterministic({ npcDefinitionId: FINNICK, lastExchange: "a" });
    await store.mergeDeterministic({ npcDefinitionId: FINNICK, lastExchange: "b" });

    // Conversation 2's summarizer lands first.
    const newer = await store.mergeSummary(
      { npcDefinitionId: FINNICK, relationshipSummary: "from conversation 2" },
      2
    );
    expect(newer).toBe(true);

    // Conversation 1's summarizer lands LATE — it must not regress the record.
    const stale = await store.mergeSummary(
      { npcDefinitionId: FINNICK, relationshipSummary: "from conversation 1" },
      1
    );
    expect(stale).toBe(false);

    const record = await store.load(FINNICK);
    expect(record?.relationshipSummary).toBe("from conversation 2");
    expect(record?.summaryCounter).toBe(2);
  });
});

describe("NpcMemoryStore operation ordering", () => {
  it("orders a load behind an in-flight merge (single promise chain)", async () => {
    // A backend whose writes resolve on a deferred macrotask makes the
    // race real: without serialization, the load would observe the
    // pre-merge (empty) state.
    const inner = new InMemoryNpcMemoryBackend();
    const slow: NpcMemoryBackend = {
      get: (key) => inner.get(key),
      delete: (key) => inner.delete(key),
      all: () => inner.all(),
      put: (record) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            inner.put(record).then(resolve);
          }, 5);
        })
    };
    const store = storeOn(slow);

    const mergePromise = store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "slow write"
    });
    // Issue the load WITHOUT awaiting the merge.
    const loaded = await store.load(FINNICK);

    expect(loaded?.metCount).toBe(1);
    await mergePromise;
  });
});

describe("NpcMemoryStore record migration", () => {
  it("upgrades a partial/older record on read", async () => {
    const backend = new InMemoryNpcMemoryBackend();
    // Simulate a record written by an older/partial version: missing
    // arrays + a stale schemaVersion, written directly under the key.
    const key = `${USER}::${PLAY_A}::${FINNICK}`;
    await backend.put({
      key,
      userId: USER,
      playthroughId: PLAY_A,
      npcDefinitionId: FINNICK,
      schemaVersion: 0,
      metCount: 3,
      conversationCounter: 3
    } as unknown as NpcMemoryRecord);

    const store = storeOn(backend);
    const record = await store.load(FINNICK);

    expect(record?.schemaVersion).toBe(1);
    expect(record?.metCount).toBe(3);
    expect(record?.salientFacts).toEqual([]);
    expect(record?.promises).toEqual([]);
    expect(record?.relationshipSummary).toBe("");
  });

  it("migrateNpcMemoryRecord returns null for a non-record", () => {
    expect(migrateNpcMemoryRecord(null)).toBeNull();
    expect(migrateNpcMemoryRecord(42)).toBeNull();
    expect(migrateNpcMemoryRecord({ notAKey: true })).toBeNull();
  });
});

describe("NpcMemoryStore reset", () => {
  it("prunes other playthroughs for this user, leaving other users alone", async () => {
    const backend = new InMemoryNpcMemoryBackend();
    await storeOn(backend, { playthroughId: PLAY_A }).mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "old playthrough"
    });
    await storeOn(backend, { userId: "other-user", playthroughId: PLAY_A }).mergeDeterministic(
      { npcDefinitionId: FINNICK, lastExchange: "other user" }
    );

    const current = storeOn(backend, { playthroughId: PLAY_B });
    await current.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "current playthrough"
    });

    await current.reset();

    // This user's stale playthrough A record is gone...
    expect(
      await storeOn(backend, { playthroughId: PLAY_A }).load(FINNICK)
    ).toBeNull();
    // ...but the current playthrough and the other user survive.
    expect((await current.load(FINNICK))?.lastExchange).toBe("current playthrough");
    expect(
      (await storeOn(backend, {
        userId: "other-user",
        playthroughId: PLAY_A
      }).load(FINNICK))?.lastExchange
    ).toBe("other user");
  });
});

describe("NpcMemoryStore debug helpers (073.5 dev handle)", () => {
  it("lists only the current playthrough's records", async () => {
    const backend = new InMemoryNpcMemoryBackend();
    await storeOn(backend, { playthroughId: PLAY_A }).mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "a"
    });
    await storeOn(backend, { playthroughId: PLAY_A }).mergeDeterministic({
      npcDefinitionId: HORACE,
      lastExchange: "b"
    });
    await storeOn(backend, { playthroughId: PLAY_B }).mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "other playthrough"
    });

    const list = await storeOn(backend, { playthroughId: PLAY_A }).debugListRecords();
    expect(list.map((record) => record.npcDefinitionId).sort()).toEqual(
      [FINNICK, HORACE].sort()
    );
  });

  it("forgets one NPC, then all NPCs, for the current playthrough", async () => {
    const backend = new InMemoryNpcMemoryBackend();
    const store = storeOn(backend);
    await store.mergeDeterministic({ npcDefinitionId: FINNICK, lastExchange: "a" });
    await store.mergeDeterministic({ npcDefinitionId: HORACE, lastExchange: "b" });

    await store.debugForget(FINNICK);
    expect(await store.load(FINNICK)).toBeNull();
    expect((await store.load(HORACE))?.metCount).toBe(1);

    await store.debugForget();
    expect(await store.load(HORACE)).toBeNull();
  });
});

describe("NpcMemoryStore IndexedDB backend (durability smoke)", () => {
  it("persists across store instances backed by the same database", async () => {
    const indexedDbFactory = new IDBFactory();
    const first = new NpcMemoryStore({
      userId: USER,
      playthroughId: PLAY_A,
      indexedDbFactory
    });
    await first.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "persisted"
    });
    await first.mergeSummary(
      { npcDefinitionId: FINNICK, salientFacts: ["remembered"] },
      1
    );

    // A fresh store over the same factory/user reads the durable record.
    const second = new NpcMemoryStore({
      userId: USER,
      playthroughId: PLAY_A,
      indexedDbFactory
    });
    const record = await second.load(FINNICK);

    expect(record?.metCount).toBe(1);
    expect(record?.lastExchange).toBe("persisted");
    expect(record?.salientFacts).toEqual(["remembered"]);
  });

  it("falls back to memory when no IndexedDB factory is available", async () => {
    const store = new NpcMemoryStore({
      userId: USER,
      playthroughId: PLAY_A,
      indexedDbFactory: null
    });
    await store.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "memory only"
    });
    expect((await store.load(FINNICK))?.metCount).toBe(1);
  });
});
