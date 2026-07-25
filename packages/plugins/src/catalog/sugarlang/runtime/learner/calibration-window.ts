/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/calibration-window.ts
 *
 * Purpose: Single definition of the post-placement calibration window --
 *          the settling-in period after placement during which observations
 *          carry elevated weight and confidence is recomputed from evidence.
 *
 * Exports:
 *   - CALIBRATION_CONFIDENCE_CEILING
 *   - CALIBRATION_TURN_BACKSTOP
 *   - CALIBRATION_OBSERVATION_WEIGHT
 *   - isInPostPlacementCalibration
 *
 * Relationships:
 *   - Depends on learner-profile types only.
 *   - Consumed by the learner-state reducer (weighted in-window updates) and
 *     re-exported by teacher/calibration-mode for the Director's hint surface.
 *     One enforcer: do not duplicate this predicate.
 *
 * Implements: Plan 081 story 081.4
 *
 * Status: active
 */

import type { LearnerProfile } from "../types";

// Window closes when confidence reaches this ceiling (evidence close) ...
export const CALIBRATION_CONFIDENCE_CEILING = 0.65;
// ... or when the session hits this many turns (backstop close).
export const CALIBRATION_TURN_BACKSTOP = 10;
// In-window graded observations carry this weight into the CEFR posterior.
// Bounded: applies only while the window is open, and only to the Bayesian
// posterior -- ts-fsrs card scheduling is untouched.
export const CALIBRATION_OBSERVATION_WEIGHT = 3;

export function isInPostPlacementCalibration(
  learner: LearnerProfile
): boolean {
  if (learner.assessment.status !== "evaluated") {
    return false;
  }

  const turns = learner.currentSession?.turns ?? 0;
  return (
    learner.assessment.cefrConfidence < CALIBRATION_CONFIDENCE_CEILING &&
    turns < CALIBRATION_TURN_BACKSTOP
  );
}
