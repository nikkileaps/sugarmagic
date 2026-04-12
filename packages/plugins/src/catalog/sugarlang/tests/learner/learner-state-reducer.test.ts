/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/learner-state-reducer.test.ts
 *
 * Purpose: Verifies learner-state reducer event handling, single-writer discipline, and provisional-evidence lifecycle behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/learner/learner-state-reducer as the implementation under test.
 *   - Covers the Epic 7 reducer acceptance criteria.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
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
  LEARNER_PROFILE_FACT,
  SUGARLANG_PLACEMENT_STATUS_FACT,
  getSugarlangPlacementStatus
} from "../../runtime/learner/fact-definitions";
import {
  LearnerStateReducer
} from "../../runtime/learner/learner-state-reducer";
import {
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD
} from "../../runtime/types";
import {
  IndexedDBCardStore,
  MemoryCardStore
} from "../../runtime/learner/card-store";
import {
  createAtlasProvider,
  createLearnerBlackboard,
  createLearnerProfile,
  createLemmaCard,
  createReducerObservationEvent
} from "./test-helpers";

describe("LearnerStateReducer", () => {
  it("defines sugarlang facts with working ownership and placement defaults", () => {
    const blackboard = createLearnerBlackboard();
    const profile = createLearnerProfile("A1");

    blackboard.setFact({
      definition: LEARNER_PROFILE_FACT,
      scope: createBlackboardScope("entity", "player-1"),
      value: profile,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem
    });

    expect(
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-1"))?.value
    ).toEqual(profile);
    expect(() =>
      blackboard.setFact({
        definition: LEARNER_PROFILE_FACT,
        scope: createBlackboardScope("entity", "player-1"),
        value: profile,
        sourceSystem: "not-sugarlang"
      })
    ).toThrow(/owned by/i);
    expect(getSugarlangPlacementStatus(blackboard, "learner-epic-7")).toEqual({
      status: "not-started"
    });
    expect(
      blackboard.getFact(
        SUGARLANG_PLACEMENT_STATUS_FACT,
        createBlackboardScope("global", "learner-epic-7")
      )
    ).toBeNull();
  });

  it("handles self-report, observation, and placement-completion events in sequence", async () => {
    const blackboard = createLearnerBlackboard();
    const emit = vi.fn().mockResolvedValue(undefined);
    const atlas = createAtlasProvider([
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "viajar", cefrPriorBand: "A2" },
      { lemmaId: "familia", cefrPriorBand: "A1" }
    ]);
    const reducer = new LearnerStateReducer({
      profileId: "learner-epic-7" as ReturnType<typeof createLearnerProfile>["learnerId"],
      playerEntityId: "player-1",
      targetLanguage: "es",
      supportLanguage: "en",
      blackboard,
      cardStore: new MemoryCardStore(),
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas),
      telemetry: { emit }
    });

    await reducer.apply({ type: "self-report", band: "A2" });
    await reducer.apply({
      type: "session-start",
      sessionId: "session-1",
      startedAtMs: 1000
    });
    await reducer.apply({
      type: "observation",
      observationEvent: createReducerObservationEvent({
        lemmaId: "hola",
        kind: "quest-success",
        observedAtMs: 1500
      })
    });
    await reducer.apply({
      type: "placement-completion",
      cefrBand: "A2",
      confidence: 0.82,
      completedAtMs: 5000,
      lemmasSeededFromFreeText: [
        { lemmaId: "viajar", lang: "es" },
        { lemmaId: "familia", lang: "es" }
      ]
    });

    const profile =
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-1"))
        ?.value;

    expect(profile?.estimatedCefrBand).toBe("A2");
    expect(profile?.assessment.status).toBe("evaluated");
    expect(profile?.lemmaCards.hola.reviewCount).toBe(1);
    expect(profile?.lemmaCards.viajar.reviewCount).toBe(1);
    expect(profile?.lemmaCards.familia.reviewCount).toBe(1);
    expect(profile?.lemmaCards.viajar.productiveStrength).toBeGreaterThan(0);
    expect(profile?.currentSession?.turns).toBe(1);
    expect(getSugarlangPlacementStatus(blackboard, "learner-epic-7")).toEqual({
      status: "completed",
      cefrBand: "A2",
      confidence: 0.82,
      completedAt: 5000
    });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "fsrs.seeded-from-placement",
        lemmaId: "viajar"
      })
    );
  });

  it("serializes parallel apply calls through the reducer queue", async () => {
    const blackboard = createLearnerBlackboard();
    const atlas = createAtlasProvider([
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "gracias", cefrPriorBand: "A1" }
    ]);
    const reducer = new LearnerStateReducer({
      profileId: "learner-epic-7" as ReturnType<typeof createLearnerProfile>["learnerId"],
      playerEntityId: "player-2",
      targetLanguage: "es",
      supportLanguage: "en",
      blackboard,
      cardStore: new MemoryCardStore(),
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    await reducer.apply({
      type: "session-start",
      sessionId: "session-1",
      startedAtMs: 1000
    });
    await Promise.all([
      reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "hola",
          kind: "quest-success",
          observedAtMs: 1500,
          turnId: "turn-1"
        })
      }),
      reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "gracias",
          kind: "produced-chosen",
          observedAtMs: 2200,
          turnId: "turn-2"
        })
      })
    ]);

    const profile =
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-2"))
        ?.value;

    expect(profile?.lemmaCards.hola.reviewCount).toBe(1);
    expect(profile?.lemmaCards.gracias.reviewCount).toBe(1);
    expect(profile?.currentSession?.turns).toBe(2);
  });

  it("supports provisional evidence accumulate, commit, discard, and decay flows", async () => {
    const emit = vi.fn();
    const blackboard = createLearnerBlackboard();
    const store = new MemoryCardStore();
    const atlas = createAtlasProvider([{ lemmaId: "hola", cefrPriorBand: "A1" }]);
    const reducer = new LearnerStateReducer({
      profileId: "learner-epic-7" as ReturnType<typeof createLearnerProfile>["learnerId"],
      playerEntityId: "player-3",
      targetLanguage: "es",
      supportLanguage: "en",
      blackboard,
      cardStore: store,
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas),
      telemetry: { emit }
    });

    await reducer.apply({
      type: "session-start",
      sessionId: "session-rapid",
      startedAtMs: 1000
    });
    for (let index = 0; index < 5; index += 1) {
      await reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "hola",
          kind: "rapid-advance",
          observedAtMs: 1100 + index * 100,
          turnId: `turn-${index + 1}`,
          dwellMs: 3000
        })
      });
    }

    let profile =
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-3"))
        ?.value;
    const seededStability = profile?.lemmaCards.hola.stability ?? 0;

    expect(profile?.lemmaCards.hola.provisionalEvidence).toBeGreaterThan(0);

    await reducer.apply({
      type: "commit-provisional-evidence",
      targetLemmas: [{ lemmaId: "hola", lang: "es" }],
      committedAtMs: 4000
    });

    profile =
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-3"))
        ?.value;
    expect(profile?.lemmaCards.hola.provisionalEvidence).toBe(0);
    expect(profile?.lemmaCards.hola.stability).toBeGreaterThan(seededStability);

    await reducer.apply({
      type: "observation",
      observationEvent: createReducerObservationEvent({
        lemmaId: "hola",
        kind: "rapid-advance",
        observedAtMs: 4200,
        turnId: "turn-6",
        dwellMs: 3000
      })
    });
    const stabilityBeforeDiscard = profile?.lemmaCards.hola.stability ?? 0;
    await reducer.apply({
      type: "discard-provisional-evidence",
      targetLemmas: [{ lemmaId: "hola", lang: "es" }],
      discardedAtMs: 5000
    });
    profile =
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-3"))
        ?.value;
    expect(profile?.lemmaCards.hola.provisionalEvidence).toBe(0);
    expect(profile?.lemmaCards.hola.stability).toBe(stabilityBeforeDiscard);

    await reducer.apply({
      type: "observation",
      observationEvent: createReducerObservationEvent({
        lemmaId: "hola",
        kind: "rapid-advance",
        observedAtMs: 5200,
        turnId: "turn-7",
        dwellMs: 3000
      })
    });
    await reducer.apply({
      type: "decay-provisional-evidence",
      currentSessionTurn: PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD + 50,
      decayedAtMs: 8000
    });
    profile =
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-3"))
        ?.value;
    expect(profile?.lemmaCards.hola.provisionalEvidence).toBe(0);
    expect(emit).toHaveBeenCalled();
  });

  it("round-trips reducer state through persistence and keeps session history capped", async () => {
    const blackboard = createLearnerBlackboard();
    const cardStore = new IndexedDBCardStore({ profileId: "learner-roundtrip" });
    const atlas = createAtlasProvider([{ lemmaId: "hola", cefrPriorBand: "A1" }]);
    const reducer = new LearnerStateReducer({
      profileId: "learner-roundtrip" as ReturnType<typeof createLearnerProfile>["learnerId"],
      playerEntityId: "player-4",
      targetLanguage: "es",
      supportLanguage: "en",
      blackboard,
      cardStore,
      atlas,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });

    for (let index = 0; index < 25; index += 1) {
      await reducer.apply({
        type: "session-start",
        sessionId: `session-${index}`,
        startedAtMs: index * 1000
      });
      await reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "hola",
          kind: "rapid-advance",
          observedAtMs: index * 1000 + 100,
          turnId: `turn-${index}`
        })
      });
      await reducer.apply({
        type: "session-end",
        completedAtMs: index * 1000 + 500
      });
    }

    const learnerStore = new BlackboardLearnerStore({
      blackboard,
      playerEntityId: "player-4",
      learnerId: "learner-roundtrip" as ReturnType<typeof createLearnerProfile>["learnerId"],
      targetLanguage: "es",
      supportLanguage: "en",
      cardStore,
      learnerPriorProvider: new FsrsLearnerPriorProvider(atlas)
    });
    const reloaded = await learnerStore.getCurrentProfile();

    expect(reloaded.lemmaCards.hola.provisionalEvidence).toBeGreaterThan(0);
    expect(reloaded.sessionHistory).toHaveLength(20);
  });
});
