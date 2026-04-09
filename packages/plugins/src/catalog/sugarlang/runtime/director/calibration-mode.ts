/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/calibration-mode.ts
 *
 * Purpose: Reserves the minimal post-placement calibration hint surface for the Director.
 *
 * Exports:
 *   - isInPostPlacementCalibration
 *   - buildPostPlacementCalibrationHint
 *
 * Relationships:
 *   - Depends on learner-profile types.
 *   - Will be consumed by the Director once Epic 9 lands.
 *
 * Implements: Proposal 001 §Cold Start Sequence
 *
 * Status: skeleton (no implementation yet; see Epic 9)
 */

import type { LearnerProfile } from "../types";

export function isInPostPlacementCalibration(
  _learner: LearnerProfile
): boolean {
  throw new Error("TODO: Epic 9");
}

export function buildPostPlacementCalibrationHint(): string {
  throw new Error("TODO: Epic 9");
}
