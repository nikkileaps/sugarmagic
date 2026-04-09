/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/observations.ts
 *
 * Purpose: Reserves the pure observation-to-FSRS-grade mapping function.
 *
 * Exports:
 *   - observationToFsrsGrade
 *
 * Relationships:
 *   - Depends on the observation contract types.
 *   - Will be consumed by the learner reducer and Budgeter adapter in Epic 8.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / §Receptive vs. Productive Knowledge
 *
 * Status: skeleton (no implementation yet; see Epic 8)
 */

import type { FSRSGrade, LemmaObservation } from "../types";

export function observationToFsrsGrade(
  _observation: LemmaObservation
): FSRSGrade | null {
  throw new Error("TODO: Epic 8");
}
