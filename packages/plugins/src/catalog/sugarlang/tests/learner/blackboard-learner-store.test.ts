/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/blackboard-learner-store.test.ts
 *
 * Purpose: Verifies the BlackboardLearnerStore read model and learner-prior delegation.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/providers/impls/blackboard-learner-store and ../../runtime/providers/impls/fsrs-learner-prior-provider as the implementations under test.
 *   - Covers the Epic 7 provider acceptance criteria.
 *
 * Implements: Proposal 001 §Learner State Model / ADR 010 provider boundaries
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createBlackboardScope
} from "@sugarmagic/runtime-core";
import {
  BlackboardLearnerStore
} from "../../runtime/providers/impls/blackboard-learner-store";
import {
  FsrsLearnerPriorProvider
} from "../../runtime/providers/impls/fsrs-learner-prior-provider";
import {
  LEARNER_PROFILE_FACT
} from "../../runtime/learner/fact-definitions";
import {
  MemoryCardStore
} from "../../runtime/learner/card-store";
import {
  createAtlasProvider,
  createLearnerBlackboard,
  createLearnerProfile,
  createLemmaCard
} from "./test-helpers";

describe("BlackboardLearnerStore", () => {
  it("reads the latest written learner profile", async () => {
    const blackboard = createLearnerBlackboard();
    const atlas = createAtlasProvider([{ lemmaId: "hola", cefrPriorBand: "A1" }]);
    const priorProvider = new FsrsLearnerPriorProvider(atlas);
    const cardStore = new MemoryCardStore();
    const profile = createLearnerProfile("A2", {
      lemmaCards: {
        hola: createLemmaCard("hola", "A1")
      }
    });
    blackboard.setFact({
      definition: LEARNER_PROFILE_FACT,
      scope: createBlackboardScope("entity", "player-1"),
      value: profile,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
    });
    await cardStore.set(profile.lemmaCards.hola);

    const store = new BlackboardLearnerStore({
      blackboard,
      playerEntityId: "player-1",
      learnerId: profile.learnerId,
      targetLanguage: "es",
      supportLanguage: "en",
      cardStore,
      learnerPriorProvider: priorProvider
    });

    expect(await store.getCurrentProfile()).toEqual(profile);
  });

  it("seeds initial cards using the atlas prior band", () => {
    const atlas = createAtlasProvider([{ lemmaId: "hablar", cefrPriorBand: "B1" }]);
    const store = new BlackboardLearnerStore({
      blackboard: createLearnerBlackboard(),
      playerEntityId: "player-2",
      learnerId: "learner-2" as ReturnType<typeof createLearnerProfile>["learnerId"],
      targetLanguage: "es",
      supportLanguage: "en",
      cardStore: new MemoryCardStore(),
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    expect(store.getInitialLemmaCard("hablar", "es", "A2").cefrPriorBand).toBe("B1");
    expect(store.getCefrInitialPosterior("B1").B1.alpha).toBe(2);
  });

  it("returns cloned reads so callers cannot mutate the stored state", async () => {
    const blackboard = createLearnerBlackboard();
    const atlas = createAtlasProvider([{ lemmaId: "hola", cefrPriorBand: "A1" }]);
    const profile = createLearnerProfile("A1");
    blackboard.setFact({
      definition: LEARNER_PROFILE_FACT,
      scope: createBlackboardScope("entity", "player-3"),
      value: profile,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
    });

    const store = new BlackboardLearnerStore({
      blackboard,
      playerEntityId: "player-3",
      learnerId: profile.learnerId,
      targetLanguage: "es",
      supportLanguage: "en",
      cardStore: new MemoryCardStore(),
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    const firstRead = await store.getCurrentProfile();
    firstRead.estimatedCefrBand = "C2";

    const secondRead = await store.getCurrentProfile();
    expect(secondRead.estimatedCefrBand).toBe("A1");
  });
});
