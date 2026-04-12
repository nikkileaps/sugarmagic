/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/cefr-posterior.test.ts
 *
 * Purpose: Verifies the pure CEFR posterior helper math used by learner-state updates.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/learner/cefr-posterior as the implementation under test.
 *   - Covers the Epic 7 Bayesian posterior acceptance criteria.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  computeExpectedBand,
  computePointEstimate,
  createUniformCefrPosterior,
  seedCefrPosteriorFromSelfReport,
  updatePosterior
} from "../../runtime/learner/cefr-posterior";

describe("cefr-posterior", () => {
  it("creates a uniform posterior with equal confidence across the six bands", () => {
    const posterior = createUniformCefrPosterior();
    const estimate = computePointEstimate(posterior);

    expect(estimate.confidence).toBeCloseTo(1 / 6, 5);
    expect(computeExpectedBand(posterior)).toBeCloseTo(2.5, 5);
  });

  it("seeds the self-reported band with extra weight", () => {
    const posterior = seedCefrPosteriorFromSelfReport("B1");

    expect(posterior.B1).toEqual({ alpha: 2, beta: 1 });
    expect(posterior.A1).toEqual({ alpha: 1, beta: 1 });
  });

  it("moves the point estimate toward the updated band after repeated successes", () => {
    let posterior = createUniformCefrPosterior();
    for (let index = 0; index < 5; index += 1) {
      posterior = updatePosterior(posterior, "A2", true);
    }

    const estimate = computePointEstimate(posterior);
    expect(estimate.band).toBe("A2");
    expect(estimate.confidence).toBeGreaterThan(1 / 6);
  });

  it("does not mutate the input posterior", () => {
    const posterior = createUniformCefrPosterior();
    const copy = structuredClone(posterior);

    void updatePosterior(posterior, "B2", false);

    expect(posterior).toEqual(copy);
  });

  it("keeps confidence within a valid probability range across many updates", () => {
    let posterior = createUniformCefrPosterior();
    for (let index = 0; index < 50; index += 1) {
      posterior = updatePosterior(posterior, "C1", index % 3 !== 0);
      posterior = updatePosterior(posterior, "A2", index % 4 === 0);
      const estimate = computePointEstimate(posterior);

      expect(estimate.confidence).toBeGreaterThanOrEqual(1 / 6);
      expect(estimate.confidence).toBeLessThanOrEqual(1);
      for (const weight of Object.values(posterior)) {
        expect(weight.alpha).toBeGreaterThan(0);
        expect(weight.beta).toBeGreaterThan(0);
      }
    }
  });
});
