/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/learner-stores.test.ts
 *
 * Purpose: Building a learner's two stores (Plan 092.6.3 / 092.6.4).
 *
 * WHY THESE ARE PLAIN INPUT-TO-OUTPUT TESTS
 *   `initLearnerWords` and `initLearnerLevel` take arguments and return objects.
 *   They open no database, make no network call, and write to nothing shared,
 *   so there is no setup and nothing to undo afterwards.
 *
 *   That is new. Building a store used to add it to the sync loop's list as a
 *   side effect, so every test that built one had to unregister it in an
 *   `afterEach` -- and a test could not ask "what does this function return"
 *   without also changing what the sync loop would do next.
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  listSyncedRecordStores,
  registerActiveGameId,
  unregisterSyncedRecordStore
} from "@sugarmagic/runtime-core";
import {
  initLearnerStores,
  initLearnerLevel,
  initLearnerWords
} from "../../runtime/learner/learner-stores";

const USER = "user-alice";

beforeEach(() => {
  registerActiveGameId("test-game");
  for (const handle of listSyncedRecordStores()) {
    unregisterSyncedRecordStore(handle.storeKey);
  }
});

describe("092.6.4 - building a learner's word store", () => {
  it("THE ONE THAT MATTERS: returns a store for this language pair and syncs nothing", () => {
    const { store, handle } = initLearnerWords(USER, "it", "en");

    expect(store.storeKey.storeId).toBe("cards:it:en");
    expect(store.storeKey.pluginId).toBe("sugarlang");
    expect(store.syncMode).toBe("synced");
    expect(handle.table.tableName).toBe("sugarlang_words");
    // Building is not wiring. Nothing has been told this store exists.
    expect(listSyncedRecordStores()).toHaveLength(0);
  });

  it("keeps two language pairs apart", () => {
    // Two languages are two vocabularies with colliding lemma ids, so they
    // cannot share a store.
    expect(initLearnerWords(USER, "it", "en").store.storeKey.storeId).not.toBe(
      initLearnerWords(USER, "es", "en").store.storeKey.storeId
    );
  });
});

describe("092.6.4 - building a learner's level store", () => {
  it("returns a store for this language pair and syncs nothing", () => {
    const { store, handle } = initLearnerLevel(USER, "it", "en");

    expect(store.storeKey.storeId).toBe("profile:it:en");
    expect(handle.table.tableName).toBe("sugarlang_learner");
    expect(listSyncedRecordStores()).toHaveLength(0);
  });

  it("is a different store from the words, not a corner of it", () => {
    // Thousands of words and one level: different cardinality, different
    // shape, different table.
    expect(initLearnerLevel(USER, "it", "en").store.storeKey.storeId).not.toBe(
      initLearnerWords(USER, "it", "en").store.storeKey.storeId
    );
  });
});

describe("092.6.3 - initLearnerStores is the step that touches shared state", () => {
  it("THE ONE THAT MATTERS: puts both stores on the sync loop's list", () => {
    initLearnerStores(USER, "it", "en");

    expect(
      listSyncedRecordStores()
        .map((handle) => handle.storeKey.storeId)
        .sort()
    ).toEqual(["cards:it:en", "profile:it:en"]);
  });

  it("hands back one wait covering both", async () => {
    // Nothing is listening, so neither store will ever be reconciled and both
    // waits are already over. A caller must not hang on that.
    const { whenFirstSynced } = initLearnerStores(USER, "it", "en");
    await expect(whenFirstSynced).resolves.toBeUndefined();
  });

  it("gives back a usable word store", async () => {
    const { cardStore } = initLearnerStores(USER, "it", "en");
    await cardStore.set({
      lemmaId: "riconoscere",
      difficulty: 5,
      stability: 1,
      retrievability: 1,
      lastReviewedAt: null,
      reviewCount: 0,
      lapseCount: 0,
      cefrPriorBand: "B1",
      priorWeight: 1,
      productiveStrength: 0,
      lastProducedAtMs: null,
      provisionalEvidence: 0,
      provisionalEvidenceFirstSeenTurn: null
    });

    expect((await cardStore.get("riconoscere"))?.cefrPriorBand).toBe("B1");
  });
});
