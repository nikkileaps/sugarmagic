/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/store-registry.test.ts
 *
 * Purpose: Verifies the shared store resolver (Plan 073.2) — the seam
 * both the dispose writer and the memory-middleware reader use. Covers
 * the load-bearing New-Game behavior driven THROUGH the resolver: a
 * same-key re-resolve returns the identical cached instance; a new
 * playthroughId returns a distinct instance, reads empty, and prunes the
 * prior playthrough's rows (the fire-and-forget reset).
 *
 * Implements: Plan 073 §073.2 tests (mini-review coverage gap)
 *
 * Status: active
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryNpcMemoryBackend } from "./npc-memory-store";
import {
  clearNpcMemoryStoreCacheForTests,
  resolveNpcMemoryStore
} from "./store-registry";

const USER = "user-1";
const FINNICK = "npc.finnick";

afterEach(() => {
  clearNpcMemoryStoreCacheForTests();
});

describe("resolveNpcMemoryStore", () => {
  it("returns the identical cached instance for the same (user, playthrough)", () => {
    const backend = new InMemoryNpcMemoryBackend();
    const first = resolveNpcMemoryStore({
      userId: USER,
      playthroughId: "play-A",
      storeOptions: { backend }
    });
    const again = resolveNpcMemoryStore({
      userId: USER,
      playthroughId: "play-A",
      storeOptions: { backend }
    });
    expect(first).not.toBeNull();
    expect(again).toBe(first);
  });

  it("returns null when identity is not resolved", () => {
    expect(
      resolveNpcMemoryStore({ userId: null, playthroughId: "play-A" })
    ).toBeNull();
  });

  it("forgets the prior playthrough on New Game (distinct instance, empty read, prior rows pruned)", async () => {
    const backend = new InMemoryNpcMemoryBackend();

    // Playthrough A remembers Finnick.
    const playA = resolveNpcMemoryStore({
      userId: USER,
      playthroughId: "play-A",
      storeOptions: { backend }
    });
    await playA!.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "we met in playthrough A"
    });

    // New Game -> a new playthroughId resolves a DISTINCT store...
    const playB = resolveNpcMemoryStore({
      userId: USER,
      playthroughId: "play-B",
      storeOptions: { backend }
    });
    expect(playB).not.toBe(playA);
    // ...that reads empty (fresh playthrough keys miss)...
    expect(await playB!.load(FINNICK)).toBeNull();

    // ...and the fire-and-forget reset prunes playthrough A's row.
    await vi.waitFor(async () => {
      const rows = (await backend.all()) as Array<{ playthroughId: string }>;
      expect(rows.some((row) => row.playthroughId === "play-A")).toBe(false);
    });
  });
});
