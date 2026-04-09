/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/cefr-posterior.ts
 *
 * Purpose: Reserves the Bayesian CEFR posterior update surface.
 *
 * Exports:
 *   - updatePosterior
 *
 * Relationships:
 *   - Depends on learner-profile and observation contract types.
 *   - Will be consumed by LearnerStateReducer once Epic 7 lands.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { CefrPosterior, LemmaObservation } from "../types";

export function updatePosterior(
  _posterior: CefrPosterior,
  _observation: LemmaObservation
): CefrPosterior {
  throw new Error("TODO: Epic 7");
}
