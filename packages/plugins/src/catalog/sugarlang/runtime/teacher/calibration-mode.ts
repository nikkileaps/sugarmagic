/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/calibration-mode.ts
 *
 * Purpose: Reserves the minimal post-placement calibration hint surface for the Director.
 *
 * Exports:
 *   - isInPostPlacementCalibration
 *   - buildPostPlacementCalibrationHint
 *
 * Relationships:
 *   - Depends on learner-profile types.
 *   - Will be consumed by the Teacher'sonce Epic 9 lands.
 *
 * Implements: Proposal 001 §Cold Start Sequence
 *
 * Status: skeleton (no implementation yet; see Epic 9)
 */

import type { LearnerProfile } from "../types";

export function isInPostPlacementCalibration(
  learner: LearnerProfile
): boolean {
  if (learner.assessment.status !== "evaluated") {
    return false;
  }

  const turns = learner.currentSession?.turns ?? 0;
  return learner.assessment.cefrConfidence < 0.65 && turns < 10;
}

export function buildPostPlacementCalibrationHint(): string {
  return "NOTE: This learner just completed their placement assessment but has not yet built up session history. Lean slightly toward the cautious side - prefer supported posture over target-dominant, prefer inline glossing on any new word, keep sentences at one or two clauses. This is a brief settling-in window, not a permanent constraint.";
}
