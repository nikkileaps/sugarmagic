/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/calibration-mode.ts
 *
 * Purpose: Provides the Director-facing post-placement calibration hint.
 *
 * Exports:
 *   - isInPostPlacementCalibration (re-export; single definition lives in
 *     learner/calibration-window)
 *   - buildPostPlacementCalibrationHint
 *
 * Relationships:
 *   - Re-exports the window predicate from ../learner/calibration-window.
 *   - Is consumed by the teacher policies to soften posture during the window.
 *
 * Implements: Proposal 001 §Cold Start Sequence / Plan 081 story 081.4
 *
 * Status: active
 */

export { isInPostPlacementCalibration } from "../learner/calibration-window";

export function buildPostPlacementCalibrationHint(): string {
  return "NOTE: This learner just completed their placement assessment but has not yet built up session history. Lean slightly toward the cautious side - prefer supported posture over target-dominant, prefer inline glossing on any new word, keep sentences at one or two clauses. This is a brief settling-in window, not a permanent constraint.";
}
