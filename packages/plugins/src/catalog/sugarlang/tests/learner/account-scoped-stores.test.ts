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
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { signInTestAccount } from "./signed-in-test-account";
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
let signOut: (() => void) | undefined;
// A signed-in account, because every per-player store is scoped to one and
// refuses to open without it -- the same path production takes.
beforeEach(() => {
  registerActiveGameId("test-game");
  signOut = signInTestAccount();
});
afterEach(() => signOut?.());

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
    // Signed in as each in turn, because that is the only way this happens:
    // one person signs out, another signs in, same browser. A store refuses to
    // open under an account that is not the current one.
    signOut?.();
    signOut = signInTestAccount("user-alice");
    const alice = new IndexedDBCardStore({ profileId: learnerIdFor("user-alice") });
    await alice.set(card("formaggio"));

    signOut();
    signOut = signInTestAccount("user-bob");
    const bob = new IndexedDBCardStore({ profileId: learnerIdFor("user-bob") });
    await bob.set(card("pane"));

    expect((await alice.list()).map((c) => c.lemmaId)).toEqual(["formaggio"]);
    expect((await bob.list()).map((c) => c.lemmaId)).toEqual(["pane"]);

    await alice.close?.();
    await bob.close?.();
  });

  it("the same account coming back sees the words it left", async () => {
    signOut?.();
    signOut = signInTestAccount("user-returning");
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
      /not scoped to the signed-in account/
    );
    expect(() => new IndexedDBCardStore({ profileId: "player" })).toThrow(
      /not scoped to the signed-in account/
    );
  });

  it("THE ONE THAT MATTERS: rejects the pre-092 unscoped id, whatever its shape", () => {
    // COUNTING SEGMENTS CANNOT DECIDE THIS, which two versions of the guard
    // learned the hard way. A real player definition id contains colons of its
    // own -- `wordlark:player:default` -- so a scoped id has four fields and
    // six segments, while the unscoped `playerEntityId:target:support` has
    // three or five depending on the player. "More than one" passed the id it
    // existed to reject; "exactly four" rejected every real one.
    signOut?.();
    signOut = signInTestAccount("user-alice");

    // Unscoped, three segments.
    expect(() => assertAccountScopedLearnerId("player:it:en", "test")).toThrow(
      /not scoped to the signed-in account/
    );
    // Unscoped, five segments -- the shape a real player definition produces.
    expect(() =>
      assertAccountScopedLearnerId("wordlark:player:default:it:en", "test")
    ).toThrow(/not scoped to the signed-in account/);
    // Scoped, six segments. This is what the running game actually passes, and
    // the previous guard rejected it.
    expect(() =>
      assertAccountScopedLearnerId("user-alice:wordlark:player:default:it:en", "test")
    ).not.toThrow();
    // Scoped to SOMEBODY ELSE.
    expect(() =>
      assertAccountScopedLearnerId("user-bob:wordlark:player:default:it:en", "test")
    ).toThrow(/not scoped to the signed-in account/);
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
    expect(() => createTeachRecordStore("player")).toThrow(
      /not scoped to the signed-in account/
    );
    expect(() => createEncounterDebtLedger("player")).toThrow(
      /not scoped to the signed-in account/
    );
  });
});
