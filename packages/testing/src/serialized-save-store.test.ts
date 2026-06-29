/**
 * Regression tests for the structural guarantee that the
 * "New Game" save-reset race cannot recur.
 *
 * Background: the 053.7 fix added a halt() handle to the
 * useAutosave hook so the start-new-game flow could flush any
 * in-flight write before deleting the save. That fix is per-
 * hook-generation, requires every callsite to remember to call
 * halt() first, and resets the halted flag whenever the hook's
 * deps change — fragile by construction.
 *
 * The structural replacement is `createSerializedSaveStore`,
 * which moves the guarantee INTO the store: every operation
 * (load/save/clear/resetForNewGame) serializes on a single
 * Promise chain, and resetForNewGame permanently freezes the
 * store so any future save() call is a no-op.
 *
 * These tests are the canary. If any of them go red, the
 * structural guarantee is broken and the New Game bug can
 * recur in prod.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  GAME_SAVE_SCHEMA_VERSION,
  createSerializedSaveStore,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore
} from "@sugarmagic/runtime-core";

function buildPayload(x: number): GameSavePayload {
  return {
    currentRegionId: "region:test",
    currentQuestId: null,
    playerPosition: { x, y: 0, z: 0 }
  };
}

function buildSave(userId: string, x: number): GameSave {
  return {
    userId,
    lastPlayed: new Date(0).toISOString(),
    schemaVersion: GAME_SAVE_SCHEMA_VERSION,
    payload: buildPayload(x)
  };
}

/**
 * Lets pending microtasks AND macrotasks run. Used after
 * dispatching a queued op so the wrapper's `chain.then(work)`
 * advances and `work` registers its resolver before we try to
 * release it.
 */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * In-memory raw store where each save() blocks on a deferred
 * the test releases manually. `startedSaves` increments
 * synchronously when the wrapper invokes raw.save(), so tests
 * can wait until the wrapper has actually dispatched the call
 * before releasing it.
 */
function makeGatedStore(): {
  raw: GameSaveStore;
  /** Releases the oldest unreleased save. Resolves once the
   *  resolver has run (the raw write has landed). */
  releaseNextSave(): Promise<void>;
  /** Releases every save accumulated so far. */
  releaseAllSaves(): Promise<void>;
  /** Inspect the persisted record. */
  current(): GameSave | null;
  /** How many writes have landed in the underlying store. */
  writeCount(): number;
  /** How many save() calls the wrapper has dispatched into
   *  raw.save (whether or not they've resolved yet). */
  startedSaves(): number;
} {
  let record: GameSave | null = null;
  let writes = 0;
  let started = 0;
  const pending: Array<() => void> = [];

  const raw: GameSaveStore = {
    async load() {
      return record;
    },
    save(userId, save) {
      if (save.userId !== userId) throw new Error("userId mismatch");
      started += 1;
      return new Promise<void>((resolve) => {
        pending.push(() => {
          writes += 1;
          record = save;
          resolve();
        });
      });
    },
    async clear() {
      record = null;
    }
  };

  async function waitForPending(): Promise<void> {
    // Yield until raw.save has been entered and pushed its
    // resolver. Bounded to keep test failures debuggable.
    for (let i = 0; i < 50; i += 1) {
      if (pending.length > 0) return;
      await tick();
    }
    throw new Error(
      "[test] timed out waiting for a pending save to be dispatched into raw.save"
    );
  }

  return {
    raw,
    async releaseNextSave() {
      await waitForPending();
      const next = pending.shift();
      if (next) next();
      await tick();
    },
    async releaseAllSaves() {
      // Drain any already-queued resolvers, then yield once
      // (so the chain advances and any next save() can push
      // its own resolver), then drain again. Keep going until
      // stable.
      for (let pass = 0; pass < 200; pass += 1) {
        const had = pending.length > 0;
        while (pending.length > 0) {
          const next = pending.shift();
          if (next) next();
        }
        await tick();
        if (!had && pending.length === 0) return;
      }
    },
    current: () => record,
    writeCount: () => writes,
    startedSaves: () => started
  };
}

describe("createSerializedSaveStore", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("serializes concurrent save() calls in arrival order", async () => {
    const ctrl = makeGatedStore();
    const store = createSerializedSaveStore(ctrl.raw);

    const a = store.save("u", buildSave("u", 1));
    const b = store.save("u", buildSave("u", 2));
    const c = store.save("u", buildSave("u", 3));

    expect(ctrl.writeCount()).toBe(0);

    await ctrl.releaseNextSave();
    await a;
    expect(ctrl.current()?.payload.playerPosition?.x).toBe(1);

    await ctrl.releaseNextSave();
    await b;
    expect(ctrl.current()?.payload.playerPosition?.x).toBe(2);

    await ctrl.releaseNextSave();
    await c;
    expect(ctrl.current()?.payload.playerPosition?.x).toBe(3);
  });

  it("THE CANONICAL RACE: resetForNewGame awaits an in-flight save, then deletes, then blocks subsequent writes", async () => {
    // Track raw.clear() so we can assert it ran AFTER the
    // in-flight write resolved — the canonical ordering the
    // 053.7 halt() fix targeted, now enforced by the store.
    const events: Array<{ kind: "save-landed" | "clear-ran"; x?: number }> = [];

    const ctrl = makeGatedStore();
    const tracedRaw: GameSaveStore = {
      load: (uid) => ctrl.raw.load(uid),
      save: async (uid, save) => {
        await ctrl.raw.save(uid, save);
        events.push({
          kind: "save-landed",
          x: save.payload.playerPosition?.x
        });
      },
      clear: async (uid) => {
        events.push({ kind: "clear-ran" });
        await ctrl.raw.clear(uid);
      }
    };
    const store = createSerializedSaveStore(tracedRaw);

    // Step 1: a save is in flight (mid-write). This models
    // the autosave tick currently mid-`store.save(userId,
    // payload)` when the player clicks New Game.
    const inFlight = store.save("u", buildSave("u", 99));
    await tick();
    expect(ctrl.startedSaves()).toBe(1);

    // Step 2: the New Game flow fires resetForNewGame.
    const resetPromise = store.resetForNewGame("u");

    // Step 3: before releasing the in-flight save, no clear
    // can have run (the chain is still waiting on the save).
    await tick();
    expect(events).toEqual([]);

    // Step 4: release the in-flight save. The chain then
    // advances through clear() automatically.
    await ctrl.releaseNextSave();
    await Promise.all([inFlight, resetPromise]);

    // ORDERING: the stale save landed in the underlying
    // store BEFORE clear() ran. This is what makes the
    // post-clear state authoritative — clear deletes the
    // stale write, instead of the stale write landing AFTER
    // clear and surviving past the reload.
    expect(events).toEqual([
      { kind: "save-landed", x: 99 },
      { kind: "clear-ran" }
    ]);

    // Step 5: any save attempted after this point is a no-op.
    // This is the structural guarantee — autosave ticks
    // scheduled after the reset can't corrupt the cleared
    // state.
    await store.save("u", buildSave("u", 42));
    expect(ctrl.writeCount()).toBe(1); // only the stale write
    expect(events.filter((e) => e.kind === "save-landed").length).toBe(1);
  });

  it("blocks save() calls queued behind resetForNewGame (race: save queued while reset is mid-chain)", async () => {
    const ctrl = makeGatedStore();
    const store = createSerializedSaveStore(ctrl.raw);

    const inFlight = store.save("u", buildSave("u", 1));
    const reset = store.resetForNewGame("u");
    const lateWrite = store.save("u", buildSave("u", 999));

    await ctrl.releaseAllSaves();
    await Promise.all([inFlight, reset, lateWrite]);

    // After everything settles: row deleted; late write
    // never landed (only the first in-flight save did).
    expect(ctrl.current()).toBeNull();
    expect(ctrl.writeCount()).toBe(1);
  });

  it("resetForNewGame is callable multiple times safely (idempotent)", async () => {
    const ctrl = makeGatedStore();
    const store = createSerializedSaveStore(ctrl.raw);

    await store.resetForNewGame("u");
    await store.resetForNewGame("u");
    await store.resetForNewGame("u");

    expect(ctrl.current()).toBeNull();
  });

  it("clear() continues to allow subsequent writes (unlike resetForNewGame which freezes)", async () => {
    // Routine clear semantics must NOT change — the anon-to-
    // cloud migration calls clear() on the LOCAL store after
    // migrating and continues to use the cloud store. If
    // clear() froze the local store, a future anonymous sign-
    // in would have nowhere to write.
    const ctrl = makeGatedStore();
    const store = createSerializedSaveStore(ctrl.raw);

    const writeBefore = store.save("u", buildSave("u", 1));
    await ctrl.releaseNextSave();
    await writeBefore;

    await store.clear("u");
    expect(ctrl.current()).toBeNull();

    const writeAfter = store.save("u", buildSave("u", 2));
    await ctrl.releaseNextSave();
    await writeAfter;
    expect(ctrl.current()?.payload.playerPosition?.x).toBe(2);
  });

  it("freeze persists even if the underlying clear() rejects (defense in depth)", async () => {
    // If Supabase DELETE fails for any transient reason, we
    // do NOT know what state the row is in. The safe move is
    // to freeze the store so autosave can't write OVER an
    // unknown row. The caller decides whether to reload.
    let clearShouldFail = true;
    const raw: GameSaveStore = {
      async load() {
        return null;
      },
      async save() {
        // would write
      },
      async clear() {
        if (clearShouldFail) {
          clearShouldFail = false;
          throw new Error("network unavailable");
        }
      }
    };
    const saveSpy = vi.spyOn(raw, "save");
    const store = createSerializedSaveStore(raw);

    await expect(store.resetForNewGame("u")).rejects.toThrow(
      "network unavailable"
    );

    // Subsequent saves must STILL be blocked even though the
    // clear didn't land.
    await store.save("u", buildSave("u", 1));
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("createSerializedSaveStore is idempotent (double-wrap is a no-op)", () => {
    const ctrl = makeGatedStore();
    const once = createSerializedSaveStore(ctrl.raw);
    const twice = createSerializedSaveStore(once);
    expect(twice).toBe(once);
  });

  it("flood of writes from a runaway autosave is fully blocked after reset", async () => {
    // Models a worst-case: useAutosave's setInterval keeps
    // firing ticks even after New Game. Without the
    // structural guarantee, each tick that fires AFTER halt
    // resolves but BEFORE window.location.reload commits
    // would write. We assert that EVEN IF 50 writes are
    // dispatched concurrent with the reset, zero of them
    // land in the store.
    const ctrl = makeGatedStore();
    const store = createSerializedSaveStore(ctrl.raw);

    const reset = store.resetForNewGame("u");
    const writes = Array.from({ length: 50 }, (_, i) =>
      store.save("u", buildSave("u", i))
    );

    await ctrl.releaseAllSaves();
    await Promise.all([reset, ...writes]);

    expect(ctrl.writeCount()).toBe(0);
    expect(ctrl.current()).toBeNull();
  });
});
