/**
 * packages/plugins/src/catalog/sugarlang/tests/budgeter/fsrs-adapter.test.ts
 *
 * Purpose: Verifies the FSRS adapter, productive-strength updates, and provisional-evidence helpers.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/budgeter/fsrs-adapter as the implementation under test.
 *   - Covers Epic 8 Story 8.1.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  PRODUCTIVE_DECAY_HALF_LIFE_DAYS,
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD,
  PROVISIONAL_EVIDENCE_MAX,
  applyOutcome,
  commitProvisionalEvidence,
  decayProductiveStrength,
  decayProvisionalEvidence,
  discardProvisionalEvidence,
  seedCardFromAtlas
} from "../../runtime/budgeter/fsrs-adapter";
import { observationToOutcome } from "../../runtime/budgeter/observations";
import { createBudgeterLemmaCard } from "./test-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("fsrs-adapter", () => {
  it("advances stability for a Good receptive outcome", () => {
    const card = createBudgeterLemmaCard("hola", "A1");

    const nextCard = applyOutcome(
      card,
      { receptiveGrade: "Good", productiveStrengthDelta: 0, provisionalEvidenceDelta: 0 },
      1_000
    );

    expect(nextCard.stability).toBeGreaterThan(card.stability);
    expect(nextCard.reviewCount).toBeGreaterThan(card.reviewCount);
  });

  it("applies Again by incrementing lapses and reducing review state quality", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      reviewCount: 2,
      lastReviewedAt: 500,
      lapseCount: 0
    });

    const nextCard = applyOutcome(
      card,
      { receptiveGrade: "Again", productiveStrengthDelta: 0, provisionalEvidenceDelta: 0 },
      2_000
    );

    expect(nextCard.lapseCount).toBeGreaterThan(card.lapseCount);
    expect(nextCard.reviewCount).toBeGreaterThan(card.reviewCount);
  });

  it("updates productive strength and lastProducedAtMs for positive production deltas", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      productiveStrength: 0.2
    });

    const nextCard = applyOutcome(
      card,
      { receptiveGrade: "Easy", productiveStrengthDelta: 0.3, provisionalEvidenceDelta: 0 },
      1_500
    );

    expect(nextCard.productiveStrength).toBeCloseTo(0.5, 5);
    expect(nextCard.lastProducedAtMs).toBe(1_500);
  });

  it("applies negative productive deltas and clamps within [0, 1]", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      productiveStrength: 0.4
    });

    const lowered = applyOutcome(
      card,
      { receptiveGrade: "Again", productiveStrengthDelta: -0.2, provisionalEvidenceDelta: 0 },
      1_500
    );
    const clampedHigh = applyOutcome(
      card,
      { receptiveGrade: "Easy", productiveStrengthDelta: 1, provisionalEvidenceDelta: 0 },
      1_500
    );
    const clampedLow = applyOutcome(
      card,
      { receptiveGrade: "Again", productiveStrengthDelta: -1, provisionalEvidenceDelta: 0 },
      1_500
    );

    expect(lowered.productiveStrength).toBeCloseTo(0.2, 5);
    expect(clampedHigh.productiveStrength).toBe(1);
    expect(clampedLow.productiveStrength).toBe(0);
  });

  it("seeds cards from atlas with stronger receptive priors for stronger learners", () => {
    const atlasEntry = {
      cefrPriorBand: "A1" as const,
      cefrPriorSource: "cefrlex" as const
    };
    const a1Seed = seedCardFromAtlas("hola", "es", atlasEntry, "A1");
    const c1Seed = seedCardFromAtlas("hola", "es", atlasEntry, "C1");

    expect(a1Seed.productiveStrength).toBe(0);
    expect(a1Seed.provisionalEvidence).toBe(0);
    expect(c1Seed.stability).toBeGreaterThan(a1Seed.stability);
  });

  it("decays productive strength on the configured half-life", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      productiveStrength: 1,
      lastProducedAtMs: 0
    });

    const decayed = decayProductiveStrength(
      card,
      PRODUCTIVE_DECAY_HALF_LIFE_DAYS * DAY_MS
    );

    expect(decayed.productiveStrength).toBeCloseTo(0.5, 2);
  });

  it("is immutable and deterministic for fixed inputs", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      productiveStrength: 0.3,
      provisionalEvidence: 0.2
    });
    const original = structuredClone(card);
    const outcome = observationToOutcome({
      kind: "rapid-advance",
      dwellMs: 2000,
      observedAtMs: 1000
    });

    const nextA = applyOutcome(card, outcome, 5_000, 10);
    const nextB = applyOutcome(card, outcome, 5_000, 10);

    expect(card).toEqual(original);
    expect(nextA).not.toBe(card);
    expect(nextA).toEqual(nextB);
    expect(commitProvisionalEvidence(card, 6_000)).not.toBe(card);
    expect(discardProvisionalEvidence(card)).not.toBe(card);
    expect(decayProvisionalEvidence(card, 20)).not.toBe(card);
  });

  it("accumulates and clamps provisional evidence while leaving FSRS state untouched for rapid-advance", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      stability: 1.5,
      retrievability: 0.8,
      reviewCount: 2,
      lastReviewedAt: 100
    });
    const nextCard = applyOutcome(
      card,
      observationToOutcome({
        kind: "rapid-advance",
        dwellMs: 3000,
        observedAtMs: 1_000
      }),
      1_000,
      10
    );
    const clamped = applyOutcome(
      createBudgeterLemmaCard("hola", "A1", {
        provisionalEvidence: 4.9
      }),
      { receptiveGrade: null, productiveStrengthDelta: 0, provisionalEvidenceDelta: 0.3 },
      1_000,
      10
    );

    expect(nextCard.provisionalEvidence).toBe(0.3);
    expect(nextCard.provisionalEvidenceFirstSeenTurn).toBe(10);
    expect(nextCard.stability).toBe(card.stability);
    expect(nextCard.difficulty).toBe(card.difficulty);
    expect(nextCard.retrievability).toBe(card.retrievability);
    expect(nextCard.lastReviewedAt).toBe(card.lastReviewedAt);
    expect(nextCard.reviewCount).toBe(card.reviewCount);
    expect(nextCard.lapseCount).toBe(card.lapseCount);
    expect(clamped.provisionalEvidence).toBe(PROVISIONAL_EVIDENCE_MAX);
  });

  it("commits, discards, and decays provisional evidence correctly", () => {
    const card = createBudgeterLemmaCard("hola", "A1", {
      provisionalEvidence: 2.5,
      provisionalEvidenceFirstSeenTurn: 10,
      stability: 1
    });

    const committed = commitProvisionalEvidence(card, 2_000);
    const discarded = discardProvisionalEvidence(card);
    const decayed = decayProvisionalEvidence(
      card,
      PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD + 50
    );
    const notYetDecayed = decayProvisionalEvidence(card, 15);

    expect(committed.provisionalEvidence).toBe(0);
    expect(committed.provisionalEvidenceFirstSeenTurn).toBeNull();
    expect(committed.stability).toBeGreaterThan(card.stability);
    expect(commitProvisionalEvidence(createBudgeterLemmaCard("empty", "A1")).stability).toBe(
      createBudgeterLemmaCard("empty", "A1").stability
    );
    expect(discarded.provisionalEvidence).toBe(0);
    expect(discarded.stability).toBe(card.stability);
    expect(decayed.provisionalEvidence).toBe(0);
    expect(notYetDecayed.provisionalEvidence).toBe(card.provisionalEvidence);
  });
});
