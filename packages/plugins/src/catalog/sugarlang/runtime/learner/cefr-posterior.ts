/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/cefr-posterior.ts
 *
 * Purpose: Implements the pure Bayesian CEFR posterior helpers used by learner seeding and updates.
 *
 * Exports:
 *   - CEFR_BAND_ORDER
 *   - createUniformCefrPosterior
 *   - seedCefrPosteriorFromSelfReport
 *   - seedCefrPosteriorFromPlacement
 *   - updatePosterior
 *   - computePointEstimate
 *   - computeEvidenceShare
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
import { CEFR_BAND_ORDER } from "../cefr";

// 090.9: re-exported, not declared. This was one of six identical copies; the
// declaration now lives beside the CEFRBand type in contracts/learner-profile.
export { CEFR_BAND_ORDER } from "../cefr";

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

// Placement is stronger evidence than a self-report, so the seed concentration
// scales with the placement confidence. The concentration must keep the seeded
// evidence share (1+c)/(6+c) below the calibration close threshold (0.65),
// i.e. c < ~8.3, or the window would close on the first observation regardless
// of content; the clamp ceiling of 8 sits just under that bound.
const PLACEMENT_SEED_CONCENTRATION_SCALE = 8;
const PLACEMENT_SEED_CONCENTRATION_MAX = 8;

export function seedCefrPosteriorFromPlacement(
  band: CEFRBand,
  confidence: number
): CefrPosterior {
  const concentration = Math.min(
    PLACEMENT_SEED_CONCENTRATION_MAX,
    Math.max(1, Math.round(confidence * PLACEMENT_SEED_CONCENTRATION_SCALE))
  );
  return Object.fromEntries(
    CEFR_BAND_ORDER.map((candidateBand) => [
      candidateBand,
      candidateBand === band
        ? createPosteriorWeight(1 + concentration, 1)
        : createPosteriorWeight()
    ])
  ) as CefrPosterior;
}

export function updatePosterior(
  posterior: CefrPosterior,
  band: CEFRBand,
  success: boolean,
  weight = 1
): CefrPosterior {
  return {
    ...posterior,
    [band]: {
      alpha: posterior[band].alpha + (success ? weight : 0),
      beta: posterior[band].beta + (success ? 0 : weight)
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

// Raw-alpha evidence share, prior and seed included (081.4 pinned counting
// rule). Used ONLY inside the post-placement calibration window: unlike the
// normalized-mean masses above (which cap well below the 0.65 close threshold
// whenever any band is unobserved), this is a true 0-1 scale that crosses the
// threshold under a realistic weighted observation stream. Failures increment
// beta only, so they never inflate a band's share.
export function computeEvidenceShare(
  posterior: CefrPosterior,
  band: CEFRBand
): number {
  const totalAlpha = CEFR_BAND_ORDER.reduce(
    (sum, candidateBand) => sum + posterior[candidateBand].alpha,
    0
  );
  return totalAlpha > 0 ? posterior[band].alpha / totalAlpha : 0;
}

export function computeExpectedBand(posterior: CefrPosterior): number {
  const masses = computePosteriorMasses(posterior);

  return CEFR_BAND_ORDER.reduce((sum, band, index) => sum + masses[band] * index, 0);
}
