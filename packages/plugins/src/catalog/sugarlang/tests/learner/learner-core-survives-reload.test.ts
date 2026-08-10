/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/learner-core-survives-reload.test.ts
 *
 * Purpose: A player's level and placement record outlive the tab
 *   (Plan 092.6.4).
 *
 * THE BUG THIS LOCKS OUT
 *   The profile core -- level, confidence, placement status -- was written
 *   only to the blackboard, which is memory for the life of the tab. The words
 *   were in real storage, so a returning player arrived with their whole
 *   vocabulary intact and no level attached to it, and got sent through
 *   placement again. Every session. The first outside playtester would have
 *   met this on day two.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createMemoryRecordStorage,
  createSyncedRecordStore,
  unregisterSyncedRecordStore
} from "@sugarmagic/runtime-core";
import { MemoryCardStore } from "../../runtime/learner/card-store";
import {
  createEmptyLearnerProfile,
  loadLearnerProfile,
  saveLearnerProfile,
  LEARNER_PROFILE_CORE_KEY,
  type LearnerProfileCoreStore,
  type PersistedLearnerProfileCore
} from "../../runtime/learner/persistence";
import { createLearnerBlackboard } from "./test-helpers";
import { SUGARLANG_LEARNER_TABLE } from "../../runtime/learner/account-tables";
import { LEARNER_PROFILE_FACT } from "../../runtime/learner/fact-definitions";

const PLAYER = "player-1";

function emptyProfile() {
  return createEmptyLearnerProfile({
    learnerId: "user-a:player-1:it:en" as never,
    targetLanguage: "it",
    supportLanguage: "en"
  });
}

const blackboard = createLearnerBlackboard;

/** A store backed by memory, standing in for the per-account one. */
function coreStore(): LearnerProfileCoreStore & { close: () => Promise<void> } {
  const store = createSyncedRecordStore<PersistedLearnerProfileCore>({
    pluginId: "example-plugin",
    storeId: "profile",
    schemaVersion: 1,
    userId: "user-a",
    adapter: createMemoryRecordStorage(),
    table: SUGARLANG_LEARNER_TABLE
  });
  return {
    get: (key) => store.get(key),
    put: (key, data) => store.put(key, data),
    close: async () => {
      unregisterSyncedRecordStore(store.storeKey);
      await store.close();
    }
  };
}

describe("092.6.4 - a returning player keeps their level", () => {
  it("THE ONE THAT MATTERS: the level survives a reload", async () => {
    const profileStore = coreStore();
    const cardStore = new MemoryCardStore();

    const placed = {
      ...emptyProfile(),
      estimatedCefrBand: "B1" as const,
      assessment: {
        status: "evaluated" as const,
        evaluatedCefrBand: "B1" as const,
        cefrConfidence: 0.8,
        evaluatedAtMs: 1_700_000_000_000
      }
    };
    await saveLearnerProfile({
      blackboard: blackboard(),
      playerEntityId: PLAYER,
      profile: placed,
      cardStore,
      profileStore,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
    });

    // A reload: fresh blackboard, nothing in memory, same storage.
    const reloaded = await loadLearnerProfile({
      blackboard: blackboard(),
      playerEntityId: PLAYER,
      cardStore,
      profileStore,
      fallbackProfile: emptyProfile()
    });

    expect(reloaded.estimatedCefrBand).toBe("B1");
    // The placement RECORD too, not just the band -- a band with no record
    // behind it is what sends someone back through placement.
    expect(reloaded.assessment.status).toBe("evaluated");
    expect(reloaded.assessment.evaluatedCefrBand).toBe("B1");
    await profileStore.close();
  });

  it("without the durable store it is lost, which is what shipped", async () => {
    // Pinning the old behaviour so the fix cannot be quietly undone.
    const cardStore = new MemoryCardStore();
    const placed = { ...emptyProfile(), estimatedCefrBand: "B1" as const };
    await saveLearnerProfile({
      blackboard: blackboard(),
      playerEntityId: PLAYER,
      profile: placed,
      cardStore,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
    });

    const reloaded = await loadLearnerProfile({
      blackboard: blackboard(),
      playerEntityId: PLAYER,
      cardStore,
      fallbackProfile: emptyProfile()
    });

    expect(reloaded.estimatedCefrBand).not.toBe("B1");
  });

  it("the words are NOT copied into the core record", async () => {
    // They are rows of their own in the same account store. Copying them here
    // would double every write and let the two copies disagree.
    const profileStore = coreStore();
    const cardStore = new MemoryCardStore();
    const profile = emptyProfile();
    profile.lemmaCards = {
      formaggio: {
        lemmaId: "formaggio",
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
      }
    };

    await saveLearnerProfile({
      blackboard: blackboard(),
      playerEntityId: PLAYER,
      profile,
      cardStore,
      profileStore,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
    });

    const stored = await profileStore.get(LEARNER_PROFILE_CORE_KEY);
    expect(stored).toBeDefined();
    expect((stored as Record<string, unknown>).lemmaCards).toBeUndefined();
    await profileStore.close();
  });

  it("storage that fails does not take the turn down with it", async () => {
    // A player mid-conversation must not hit an error because a write failed;
    // the blackboard still carries the profile for this session.
    const failing: LearnerProfileCoreStore = {
      get: async () => {
        throw new Error("storage unavailable");
      },
      put: async () => {
        throw new Error("storage unavailable");
      }
    };
    const cardStore = new MemoryCardStore();

    await expect(
      saveLearnerProfile({
        blackboard: blackboard(),
        playerEntityId: PLAYER,
        profile: emptyProfile(),
        cardStore,
        profileStore: failing,
        sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
      })
    ).resolves.not.toThrow();

    await expect(
      loadLearnerProfile({
        blackboard: blackboard(),
        playerEntityId: PLAYER,
        cardStore,
        profileStore: failing,
        fallbackProfile: emptyProfile()
      })
    ).resolves.toBeDefined();
  });
});
