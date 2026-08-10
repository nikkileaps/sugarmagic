/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/account-scoped-stores.test.ts
 *
 * Purpose: A player's learning data belongs to their ACCOUNT (Plan 092.6.1).
 *
 * THE BUG THIS LOCKS OUT
 *   The learner id used to be `playerEntityId:targetLanguage:supportLanguage`
 *   with no account in it, so every per-player store opened the same database
 *   for whoever was sitting at the browser. Two accounts on one machine shared
 *   one word history; one account on two machines got two. Nothing failed --
 *   it just silently mixed people together, which is also why syncing had to
 *   wait for this: pushing an unattributed history to an account would file
 *   one player's words under another's name.
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import {
  assertAccountScopedLearnerId,
  IndexedDBCardStore
} from "../../runtime/learner/card-store";
import type { LemmaCard } from "../../runtime/types";
import { createTeachRecordStore } from "../../runtime/learner/teach-record-store";
import { createEncounterDebtLedger } from "../../runtime/learner/encounter-debt-ledger";

import { registerActiveGameId } from "@sugarmagic/runtime-core";

// Storage on a player's device is named for the game they are playing, and the
// namer refuses to build a name without one -- a database with no game in its
// name is shared by every game on the origin. The host registers this from the
// boot payload in a real run.
beforeEach(() => registerActiveGameId("test-game"));

function card(lemmaId: string): LemmaCard {
  return {
    lemmaId,
    difficulty: 5,
    stability: 1,
    retrievability: 1,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    cefrPriorBand: "A1",
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

/** Matches `buildLearnerId` in runtime-services: account leads. */
const learnerIdFor = (userId: string) => `${userId}:player:it:en`;

describe("092.6.1 - learning data belongs to the account", () => {
  it("THE ONE THAT MATTERS: two accounts on one browser do not share a word history", async () => {
    const alice = new IndexedDBCardStore({ profileId: learnerIdFor("user-alice") });
    const bob = new IndexedDBCardStore({ profileId: learnerIdFor("user-bob") });

    await alice.set(card("formaggio"));
    await bob.set(card("pane"));

    expect((await alice.list()).map((c) => c.lemmaId)).toEqual(["formaggio"]);
    expect((await bob.list()).map((c) => c.lemmaId)).toEqual(["pane"]);

    await alice.close?.();
    await bob.close?.();
  });

  it("the same account coming back sees the words it left", async () => {
    const first = new IndexedDBCardStore({ profileId: learnerIdFor("user-returning") });
    await first.set(card("ricordare"));
    await first.close?.();

    const second = new IndexedDBCardStore({ profileId: learnerIdFor("user-returning") });
    expect((await second.list()).map((c) => c.lemmaId)).toEqual(["ricordare"]);
    await second.close?.();
  });

  it("a learner id with no account is REFUSED, not quietly accepted", async () => {
    // The pre-092.6.1 shape. It must not open anything.
    expect(() => assertAccountScopedLearnerId("player", "test")).toThrow(
      /carries no account/
    );
    expect(() => new IndexedDBCardStore({ profileId: "player" })).toThrow(
      /carries no account/
    );
  });

  it("the refusal tells the caller what to do instead", async () => {
    // A message that only says "invalid" sends the next person reading it to
    // the wrong place -- the fix is upstream, at whoever resolved the account.
    expect(() => assertAccountScopedLearnerId("player", "test")).toThrow(
      /defer construction until identity has settled/
    );
  });

  it("every per-player store enforces it, not just the word history", async () => {
    // The two siblings key off the same id and were equally unscoped. Missing
    // one of them would leave a shared database behind with nothing pointing
    // at it.
    expect(() => createTeachRecordStore("player")).toThrow(/carries no account/);
    expect(() => createEncounterDebtLedger("player")).toThrow(/carries no account/);
  });
});
