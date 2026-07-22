/**
 * packages/testing/src/npc-memory-new-game.test.ts
 *
 * Purpose: End-to-end proof of the Plan 073 §073.1 identity ->
 * memory wiring, over a real (fake) IndexedDB:
 *
 *   1. A playthrough with a stored id remembers an NPC.
 *   2. New Game (playthrough participant deserializes null -> mints
 *      a fresh id) makes the SAME NpcMemoryStore API return EMPTY
 *      memories, because the fresh playthroughId keys miss the prior
 *      record.
 *   3. The New Game path touches ONLY the sugaragent memory database.
 *      A sugarlang-shaped learner record (written under sugarlang's
 *      own database name) survives untouched — the deliberate D1b
 *      asymmetry: New Game resets NPC memory, never learner knowledge.
 *
 * The NpcMemoryStore here defaults its identity through the real
 * runtime-core registries (`getActiveUserId` / `getActivePlaythroughId`),
 * so this exercises the actual wiring, not a hand-passed id.
 *
 * Implements: Plan 073 §073.1 tests (D1, D1b)
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type {
  SaveSlice,
  User,
  UserIdentityProvider
} from "@sugarmagic/runtime-core";
import {
  createPlaythroughIdentitySaveParticipant,
  registerActiveIdentityProvider,
  resetActivePlaythroughIdForTests,
  type PlaythroughIdentitySlice
} from "@sugarmagic/runtime-core";
import { NpcMemoryStore } from "@sugarmagic/plugins";

const USER_ID = "user-newgame";
const FINNICK = "npc.finnick";

// Sugarlang's learner card store keys its IndexedDB database on the
// profile (language pair), NOT the playthrough — its knowledge SHOULD
// survive New Game. We mimic its database shape as a canary.
const SUGARLANG_DB_NAME = "sugarlang-card-store:en-es";
const SUGARLANG_STORE = "lemma-cards";

function anonUser(): User {
  return {
    userId: USER_ID,
    displayName: null,
    email: null,
    isAnonymous: true,
    createdAt: "2026-07-21T00:00:00.000Z"
  };
}

function registerUser(user: User): void {
  const provider = {
    currentUser: () => user,
    onChange: () => () => {},
    signIn: async () => user,
    signUp: async () => user,
    signOut: async () => {},
    linkAnonymousToCredentials: async () => user,
    getAccessToken: async () => null
  } satisfies UserIdentityProvider;
  registerActiveIdentityProvider(provider);
}

function playthroughSlice(
  playthroughId: string
): SaveSlice<PlaythroughIdentitySlice> {
  return { schemaVersion: 1, data: { playthroughId } };
}

/** Write one lemma card into a sugarlang-shaped database via raw IDB. */
function seedSugarlangCanary(lemmaId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SUGARLANG_DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(SUGARLANG_STORE, { keyPath: "lemmaId" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(SUGARLANG_STORE, "readwrite");
      tx.objectStore(SUGARLANG_STORE).put({ lemmaId, mastery: 0.7 });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** Read a lemma card back from the sugarlang-shaped database. */
function readSugarlangCanary(lemmaId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SUGARLANG_DB_NAME, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(SUGARLANG_STORE, "readonly");
      const get = tx.objectStore(SUGARLANG_STORE).get(lemmaId);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => reject(get.error);
    };
  });
}

afterEach(() => {
  resetActivePlaythroughIdForTests();
  registerActiveIdentityProvider(null);
});

describe("New Game memory reset (identity -> store integration)", () => {
  it("forgets NPC memory on New Game but leaves the sugarlang store untouched", async () => {
    registerUser(anonUser());
    await seedSugarlangCanary("de_nuevo");

    // --- Playthrough 1: Finnick remembers the player. ---
    const participant = createPlaythroughIdentitySaveParticipant({
      randomUuid: (() => {
        let n = 0;
        return () => `minted-${++n}`;
      })()
    });
    participant.deserialize(playthroughSlice("playthrough-1"));

    const store1 = new NpcMemoryStore();
    expect(store1.boundPlaythroughId).toBe("playthrough-1");
    await store1.mergeDeterministic({
      npcDefinitionId: FINNICK,
      lastExchange: "Hi! I'm Mim! I just arrived."
    });
    expect((await store1.load(FINNICK))?.metCount).toBe(1);

    // --- New Game: save row deleted + reload; participant boots with
    // no slice, mints a fresh playthroughId. ---
    resetActivePlaythroughIdForTests();
    const rebooted = createPlaythroughIdentitySaveParticipant({
      randomUuid: (() => {
        let n = 0;
        return () => `minted-${++n}`;
      })()
    });
    rebooted.deserialize(null);

    const store2 = new NpcMemoryStore();
    expect(store2.boundPlaythroughId).toBe("minted-1");
    expect(store2.boundPlaythroughId).not.toBe("playthrough-1");

    // Empty memories: the fresh playthrough's keys miss the prior record.
    expect(await store2.load(FINNICK)).toBeNull();

    // New Game housekeeping prunes the prior playthrough's rows.
    await store2.reset();

    // The sugarlang learner record is UNTOUCHED by any of the above.
    expect(await readSugarlangCanary("de_nuevo")).toEqual({
      lemmaId: "de_nuevo",
      mastery: 0.7
    });
  });
});
