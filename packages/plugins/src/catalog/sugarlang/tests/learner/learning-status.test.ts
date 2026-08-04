/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/learning-status.test.ts
 *
 * Purpose: Pins LearningStatus -- the five values, their precedence, and the
 *   fact that this module declares no thresholds of its own.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/learner/learning-status.
 *
 * Implements: Plan 090 story 090.9
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  DESIRED_RETENTION,
  DUE_RETRIEVABILITY_FLOOR,
  KNOWN_RETRIEVABILITY_FLOOR,
  LEARNING_STATUSES,
  getLearningStatus,
  type LearningStatus
} from "../../runtime/learner/learning-status";
import { DUE_RETRIEVABILITY_FLOOR as SCHEDULER_DUE_FLOOR } from "../../runtime/scheduler/outer-loop-scheduler";
import type { CEFRBand, LemmaCard } from "../../runtime/types";

function card(overrides: Partial<LemmaCard> = {}): LemmaCard {
  return {
    lemmaId: "queso",
    difficulty: 3,
    stability: 1.5,
    retrievability: 0.8,
    lastReviewedAt: 100,
    reviewCount: 2,
    lapseCount: 0,
    cefrPriorBand: "A1",
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null,
    ...overrides
  };
}

function status(
  cardValue: LemmaCard | undefined,
  itemBand: CEFRBand | undefined = "A1",
  learnerBand: CEFRBand = "A1"
): LearningStatus {
  return getLearningStatus({ card: cardValue, itemBand, learnerBand });
}

describe("getLearningStatus -- the five values", () => {
  it("no card is unseen", () => {
    expect(status(undefined)).toBe("unseen");
  });

  it("a card that was never reviewed is unseen, not learning", () => {
    // A seeded card is not evidence of exposure. Reading it as `learning` would
    // make every atlas-seeded lemma look encountered.
    expect(status(card({ reviewCount: 0, retrievability: 0.3 }))).toBe("unseen");
  });

  it("a reviewed card below the due floor is due", () => {
    expect(status(card({ retrievability: DUE_RETRIEVABILITY_FLOOR - 0.01 }))).toBe("due");
  });

  it("a reviewed card at or above the fluency floor is known", () => {
    expect(status(card({ retrievability: KNOWN_RETRIEVABILITY_FLOOR }))).toBe("known");
  });

  it("between the two floors is learning", () => {
    // Stated against the floors rather than a literal. A literal encodes
    // today's numbers, and this band moved when the due floor became the
    // desired-retention target -- 0.8 used to be learning and is now due.
    const between = (DUE_RETRIEVABILITY_FLOOR + KNOWN_RETRIEVABILITY_FLOOR) / 2;
    expect(status(card({ retrievability: between }))).toBe("learning");
  });

  it("an item more than one band above the learner is out-of-reach", () => {
    expect(status(card(), "B1", "A1")).toBe("out-of-reach");
    expect(status(card(), "A2", "A1")).not.toBe("out-of-reach");
  });
});

describe("getLearningStatus -- precedence", () => {
  it("reach beats card history", () => {
    // A learner can hold a card for a word above their band -- seen in passing,
    // or after a band re-estimate downward. Teaching it is still wrong.
    expect(status(card({ retrievability: 0.95, reviewCount: 9 }), "C2", "A1")).toBe(
      "out-of-reach"
    );
  });

  it("known is tested before due, or everything known also reads as due", () => {
    expect(status(card({ retrievability: 0.99 }))).toBe("known");
  });

  it("an unbanded item is in-reach, not out-of-reach", () => {
    // Absent evidence is not evidence of difficulty. Withholding every unbanded
    // word is the failure that is hardest to notice from the outside.
    const between = (DUE_RETRIEVABILITY_FLOOR + KNOWN_RETRIEVABILITY_FLOOR) / 2;
    expect(status(card({ retrievability: between }), undefined, "A1")).toBe(
      "learning"
    );
  });

  it("is total: every value is reachable and nothing falls through", () => {
    const produced = new Set<LearningStatus>([
      status(undefined),
      status(card({ retrievability: DUE_RETRIEVABILITY_FLOOR - 0.1 })),
      status(card({ retrievability: KNOWN_RETRIEVABILITY_FLOOR })),
      status(
        card({
          retrievability:
            (DUE_RETRIEVABILITY_FLOOR + KNOWN_RETRIEVABILITY_FLOOR) / 2
        })
      ),
      status(card(), "C1", "A1")
    ]);
    expect([...produced].sort()).toEqual([...LEARNING_STATUSES].sort());
  });
});

describe("getLearningStatus -- single enforcer", () => {
  it("the due floor IS the desired retention, not a number that matches it", () => {
    // There were two retention targets: the FSRS engine was built with 0.9 and
    // the due question used 0.7, neither aware of the other. Identity rather
    // than equality, so they cannot drift apart again by someone editing one.
    expect(DUE_RETRIEVABILITY_FLOOR).toBe(DESIRED_RETENTION);
  });

  it("the known floor sits above the due floor, so learning is reachable", () => {
    // Once the due floor became the retention target, equal floors would make
    // the middle band unreachable -- and an unreachable branch is worse than no
    // branch, because it reads as covered.
    expect(KNOWN_RETRIEVABILITY_FLOOR).toBeGreaterThan(DUE_RETRIEVABILITY_FLOOR);
  });

  it("is the same due floor the scheduler uses", () => {
    // The scheduler re-exports rather than declaring, so these are one constant
    // and not two that happen to agree today.
    expect(SCHEDULER_DUE_FLOOR).toBe(DUE_RETRIEVABILITY_FLOOR);
  });
});
