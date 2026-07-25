/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/post-placement-calibration.test.ts
 *
 * Purpose: Verifies the 081.4 post-placement calibration window -- placement
 *          seeds the posterior, in-window observations carry elevated weight,
 *          and the window closes on evidence (share >= ceiling) with the turn
 *          backstop as ceiling. Every case is pinned to what main CANNOT do.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/learner/learner-state-reducer as the implementation under test.
 *   - Depends on the pinned raw-alpha evidence-share counting rule (Plan 081.4).
 *
 * Implements: Plan 081 story 081.4
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createBlackboardScope } from "@sugarmagic/runtime-core";
import {
  FsrsLearnerPriorProvider
} from "../../runtime/providers/impls/fsrs-learner-prior-provider";
import { LEARNER_PROFILE_FACT } from "../../runtime/learner/fact-definitions";
import { LearnerStateReducer } from "../../runtime/learner/learner-state-reducer";
import { computePointEstimate } from "../../runtime/learner/cefr-posterior";
import { MemoryCardStore } from "../../runtime/learner/card-store";
import {
  createAtlasProvider,
  createLearnerBlackboard,
  createReducerObservationEvent
} from "./test-helpers";
import type { LearnerId, LearnerProfile } from "../../runtime/types";

function createCalibrationReducer(emit = vi.fn().mockResolvedValue(undefined)) {
  const blackboard = createLearnerBlackboard();
  const atlas = createAtlasProvider([
    { lemmaId: "hola", cefrPriorBand: "A1" },
    { lemmaId: "viajar", cefrPriorBand: "A2" },
    { lemmaId: "sostener", cefrPriorBand: "B1" }
  ]);
  const reducer = new LearnerStateReducer({
    profileId: "learner-calibration" as LearnerId,
    playerEntityId: "player-1",
    targetLanguage: "es",
    supportLanguage: "en",
    blackboard,
    cardStore: new MemoryCardStore(),
    atlas,
    learnerPriorProvider: new FsrsLearnerPriorProvider(atlas),
    telemetry: { emit }
  });
  const readProfile = () =>
    blackboard.getFact(
      LEARNER_PROFILE_FACT,
      createBlackboardScope("entity", "player-1")
    )?.value as LearnerProfile;
  return { reducer, emit, readProfile };
}

describe("post-placement calibration window (081.4)", () => {
  it("seeds the posterior from the placement verdict before any observation", async () => {
    const { reducer, readProfile } = createCalibrationReducer();

    await reducer.apply({
      type: "session-start",
      sessionId: "session-1",
      startedAtMs: 1000
    });
    await reducer.apply({
      type: "placement-completion",
      cefrBand: "A1",
      confidence: 0.5,
      completedAtMs: 2000,
      lemmasSeededFromFreeText: []
    });

    const profile = readProfile();
    // Concentration = round(0.5 * 8) = 4 on the placed band; others uniform.
    expect(profile.cefrPosterior.A1).toEqual({ alpha: 5, beta: 1 });
    expect(profile.cefrPosterior.B1).toEqual({ alpha: 1, beta: 1 });
    expect(computePointEstimate(profile.cefrPosterior).band).toBe("A1");
  });

  it("closes the window early on confidence with band B1 for an A1-placed learner producing consistent B1 evidence", async () => {
    const { reducer, emit, readProfile } = createCalibrationReducer();

    await reducer.apply({
      type: "session-start",
      sessionId: "session-1",
      startedAtMs: 1000
    });
    await reducer.apply({
      type: "placement-completion",
      cefrBand: "A1",
      confidence: 0.4,
      completedAtMs: 2000,
      lemmasSeededFromFreeText: []
    });

    // Seed: A1 alpha 4, all others alpha 1 (sum 9). Weighted (x3) B1
    // successes: share_B1 = (1+3k)/(9+3k) crosses 0.65 at k = 5.
    for (let turn = 1; turn <= 5; turn += 1) {
      await reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "sostener",
          kind: "quest-success",
          turnId: `turn-${turn}`,
          observedAtMs: 2000 + turn * 500
        })
      });
    }

    const profile = readProfile();
    expect(profile.estimatedCefrBand).toBe("B1");
    expect(profile.assessment.cefrConfidence).toBeGreaterThanOrEqual(0.65);
    expect(profile.currentSession?.turns).toBeLessThan(10);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calibration.window-closed",
        closeReason: "confidence",
        placementBand: "A1",
        settledBand: "B1",
        bandDelta: 2
      })
    );
  });

  it("closes the window early without band movement for a correctly-placed learner, then re-freezes confidence", async () => {
    const { reducer, emit, readProfile } = createCalibrationReducer();

    await reducer.apply({
      type: "session-start",
      sessionId: "session-1",
      startedAtMs: 1000
    });
    await reducer.apply({
      type: "placement-completion",
      cefrBand: "A2",
      confidence: 0.4,
      completedAtMs: 2000,
      lemmasSeededFromFreeText: []
    });

    // Seed: A2 alpha 4 (sum 9). Weighted (x3) on-band successes:
    // share_A2 = (4+3k)/(9+3k) crosses 0.65 at k = 2.
    for (let turn = 1; turn <= 2; turn += 1) {
      await reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "viajar",
          kind: "quest-success",
          turnId: `turn-${turn}`,
          observedAtMs: 2000 + turn * 500
        })
      });
    }

    const closed = readProfile();
    expect(closed.estimatedCefrBand).toBe("A2");
    expect(closed.currentSession?.turns).toBeLessThan(10);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calibration.window-closed",
        closeReason: "confidence",
        placementBand: "A2",
        settledBand: "A2",
        bandDelta: 0
      })
    );
    const settledConfidence = closed.assessment.cefrConfidence;
    expect(settledConfidence).toBeGreaterThanOrEqual(0.65);

    // Post-close, the evaluated freeze resumes: further observations do not
    // move confidence (this is main's :458 guard back in force).
    await reducer.apply({
      type: "observation",
      observationEvent: createReducerObservationEvent({
        lemmaId: "viajar",
        kind: "quest-success",
        turnId: "turn-3",
        observedAtMs: 4000
      })
    });
    expect(readProfile().assessment.cefrConfidence).toBe(settledConfidence);
  });

  it("does not close the window early on consistent placed-band failures (guards the degenerate counting rule)", async () => {
    const { reducer, emit, readProfile } = createCalibrationReducer();

    await reducer.apply({
      type: "session-start",
      sessionId: "session-1",
      startedAtMs: 1000
    });
    await reducer.apply({
      type: "placement-completion",
      cefrBand: "A2",
      confidence: 0.4,
      completedAtMs: 2000,
      lemmasSeededFromFreeText: []
    });

    // Failures increment beta only: no band's alpha grows, so no evidence
    // share can cross the ceiling. The window must stay open (backstop only).
    for (let turn = 1; turn <= 5; turn += 1) {
      await reducer.apply({
        type: "observation",
        observationEvent: createReducerObservationEvent({
          lemmaId: "viajar",
          kind: "produced-incorrect",
          turnId: `turn-${turn}`,
          observedAtMs: 2000 + turn * 500
        })
      });
    }

    const profile = readProfile();
    expect(profile.assessment.cefrConfidence).toBeLessThan(0.65);
    expect(profile.currentSession?.turns).toBeLessThan(10);
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "calibration.window-closed" })
    );
  });
});
