/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/cefr-posterior.ts
 *
 * Purpose: Implements the pure Bayesian CEFR posterior helpers used by learner seeding and updates.
 *
 * Exports:
 *   - CEFR_BAND_ORDER
 *   - createUniformCefrPosterior
 *   - seedCefrPosteriorFromSelfReport
 *   - updatePosterior
 *   - computePointEstimate
 *   - computeExpectedBand
 *
 * Relationships:
 *   - Depends on learner-profile contract types only.
 *   - Is consumed by learner seeding, the reducer, and the learner-prior provider.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import type { CEFRBand, CefrPosterior } from "../types";

export const CEFR_BAND_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const satisfies readonly CEFRBand[];

const SELF_REPORT_ALPHA = 2;
const SELF_REPORT_BETA = 1;

function createPosteriorWeight(alpha = 1, beta = 1) {
  return { alpha, beta };
}

function computeBandMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

function computePosteriorMasses(
  posterior: CefrPosterior
): Record<CEFRBand, number> {
  const means = Object.fromEntries(
    CEFR_BAND_ORDER.map((band) => [
      band,
      computeBandMean(posterior[band].alpha, posterior[band].beta)
    ])
  ) as Record<CEFRBand, number>;
  const totalMass = CEFR_BAND_ORDER.reduce((sum, band) => sum + means[band], 0);

  return Object.fromEntries(
    CEFR_BAND_ORDER.map((band) => [band, means[band] / totalMass])
  ) as Record<CEFRBand, number>;
}

export function createUniformCefrPosterior(): CefrPosterior {
  return {
    A1: createPosteriorWeight(),
    A2: createPosteriorWeight(),
    B1: createPosteriorWeight(),
    B2: createPosteriorWeight(),
    C1: createPosteriorWeight(),
    C2: createPosteriorWeight()
  };
}

export function seedCefrPosteriorFromSelfReport(band: CEFRBand): CefrPosterior {
  return Object.fromEntries(
    CEFR_BAND_ORDER.map((candidateBand) => [
      candidateBand,
      candidateBand === band
        ? createPosteriorWeight(SELF_REPORT_ALPHA, SELF_REPORT_BETA)
        : createPosteriorWeight()
    ])
  ) as CefrPosterior;
}

export function updatePosterior(
  posterior: CefrPosterior,
  band: CEFRBand,
  success: boolean
): CefrPosterior {
  return {
    ...posterior,
    [band]: {
      alpha: posterior[band].alpha + (success ? 1 : 0),
      beta: posterior[band].beta + (success ? 0 : 1)
    }
  };
}

export function computePointEstimate(
  posterior: CefrPosterior
): { band: CEFRBand; confidence: number } {
  const masses = computePosteriorMasses(posterior);
  let bestBand: CEFRBand = CEFR_BAND_ORDER[0];
  let bestConfidence = masses[bestBand];

  for (const band of CEFR_BAND_ORDER.slice(1)) {
    if (masses[band] > bestConfidence) {
      bestBand = band;
      bestConfidence = masses[band];
    }
  }

  return {
    band: bestBand,
    confidence: bestConfidence
  };
}

export function computeExpectedBand(posterior: CefrPosterior): number {
  const masses = computePosteriorMasses(posterior);

  return CEFR_BAND_ORDER.reduce((sum, band, index) => sum + masses[band] * index, 0);
}
