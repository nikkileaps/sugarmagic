/**
 * packages/plugins/src/catalog/sugarlang/tests/budgeter/scoring.test.ts
 *
 * Purpose: Verifies the transparent lemma scoring function used by the Budgeter.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/budgeter/scoring as the implementation under test.
 *   - Covers Epic 8 Story 8.3.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  SCORING_WEIGHTS,
  computeLemmaPriority,
  scoreBatch,
  scoreLemma
} from "../../runtime/budgeter/scoring";
import {
  createBudgeterLearner,
  createBudgeterLemmaCard,
  createBudgeterSceneLexicon
} from "./test-helpers";

describe("budgeter scoring", () => {
  it("scores due lemmas above recently reviewed ones", () => {
    const scene = createBudgeterSceneLexicon({
      entries: [{ lemmaId: "hola", band: "A1" }]
    });
    const due = createBudgeterLemmaCard("hola", "A1", { retrievability: 0.2 });
    const fresh = createBudgeterLemmaCard("hola", "A1", { retrievability: 0.95 });

    expect(
      scoreLemma(scene.lemmas.hola, due, scene, { nowMs: 1000, currentSessionTurn: 10 }).score
    ).toBeGreaterThan(
      scoreLemma(scene.lemmas.hola, fresh, scene, { nowMs: 1000, currentSessionTurn: 10 }).score
    );
  });

  it("boosts anchor lemmas and penalizes lapse-heavy lemmas", () => {
    const anchorScene = createBudgeterSceneLexicon({
      entries: [
        { lemmaId: "hola", band: "A1", anchor: true },
        { lemmaId: "adios", band: "A1" }
      ]
    });
    const card = createBudgeterLemmaCard("hola", "A1", { retrievability: 0.4 });
    const clean = createBudgeterLemmaCard("adios", "A1", {
      retrievability: 0.4,
      lapseCount: 0
    });
    const thrashing = createBudgeterLemmaCard("adios", "A1", {
      retrievability: 0.4,
      lapseCount: 3
    });

    expect(
      scoreLemma(anchorScene.lemmas.hola, card, anchorScene, {
        nowMs: 1000,
        currentSessionTurn: 10
      }).score
    ).toBeGreaterThan(
      scoreLemma(anchorScene.lemmas.adios, clean, anchorScene, {
        nowMs: 1000,
        currentSessionTurn: 10
      }).score
    );
    expect(
      scoreLemma(anchorScene.lemmas.adios, clean, anchorScene, {
        nowMs: 1000,
        currentSessionTurn: 10
      }).score
    ).toBeGreaterThan(
      scoreLemma(anchorScene.lemmas.adios, thrashing, anchorScene, {
        nowMs: 1000,
        currentSessionTurn: 10
      }).score
    );
  });

  it("makes the productive gap visible in the score components", () => {
    const scene = createBudgeterSceneLexicon({
      entries: [{ lemmaId: "llave", band: "A1" }]
    });
    const highGap = createBudgeterLemmaCard("llave", "A1", {
      stability: 0.9,
      productiveStrength: 0.1
    });
    const noGap = createBudgeterLemmaCard("llave", "A1", {
      stability: 0.9,
      productiveStrength: 0.9
    });
    const impossible = createBudgeterLemmaCard("llave", "A1", {
      stability: 0.5,
      productiveStrength: 0.9
    });

    const highGapScore = scoreLemma(scene.lemmas.llave, highGap, scene, {
      nowMs: 1000,
      currentSessionTurn: 10
    });
    const noGapScore = scoreLemma(scene.lemmas.llave, noGap, scene, {
      nowMs: 1000,
      currentSessionTurn: 10
    });
    const impossibleScore = scoreLemma(scene.lemmas.llave, impossible, scene, {
      nowMs: 1000,
      currentSessionTurn: 10
    });

    expect(highGapScore.score).toBeGreaterThan(noGapScore.score);
    expect(highGapScore.components.prodgap).toBeCloseTo(0.8, 5);
    expect(
      highGapScore.components.prodgap * SCORING_WEIGHTS.w_prodgap
    ).toBeCloseTo(0.48, 5);
    expect(impossibleScore.components.prodgap).toBe(0);
  });

  it("keeps batch scoring aligned with single-lemma scoring and exports weights", () => {
    const learner = createBudgeterLearner("A1", {
      lemmaCards: {
        hola: createBudgeterLemmaCard("hola", "A1", { retrievability: 0.2 })
      }
    });
    const scene = createBudgeterSceneLexicon({
      entries: [{ lemmaId: "hola", band: "A1" }]
    });

    const single = scoreLemma(scene.lemmas.hola, learner.lemmaCards.hola, scene, {
      nowMs: 1000,
      currentSessionTurn: 10
    });
    const batch = scoreBatch(
      [{ lemma: scene.lemmas.hola, card: learner.lemmaCards.hola }],
      scene,
      { nowMs: 1000, currentSessionTurn: 10 }
    );

    expect(batch[0]).toEqual(single);
    expect(computeLemmaPriority(scene.lemmas.hola, learner, scene)).toBe(single.score);
    expect(SCORING_WEIGHTS.w_prodgap).toBeGreaterThan(0);
  });
});
