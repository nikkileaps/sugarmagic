/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learner-state-reducer.ts
 *
 * Purpose: Reserves the single-writer learner-state reducer for sugarlang.
 *
 * Exports:
 *   - LearnerStateReducer
 *
 * Relationships:
 *   - Depends on learner-profile and observation contract types.
 *   - Will be consumed by the observer middleware once Epic 7 lands.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { LearnerProfile, LemmaObservation } from "../types";

export class LearnerStateReducer {
  apply(
    _observations: LemmaObservation[],
    _currentProfile?: LearnerProfile | null
  ): LearnerProfile {
    throw new Error("TODO: Epic 7");
  }
}
