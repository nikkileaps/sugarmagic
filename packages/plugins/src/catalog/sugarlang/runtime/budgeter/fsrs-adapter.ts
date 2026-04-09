/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/fsrs-adapter.ts
 *
 * Purpose: Reserves the FSRS adapter surface that updates learner lemma cards.
 *
 * Exports:
 *   - updateCard
 *
 * Relationships:
 *   - Depends on learner-profile and observation contract types.
 *   - Will be consumed by the Budgeter and learner reducer in Epic 8.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / §Why This Is Real ML at the Core
 *
 * Status: skeleton (no implementation yet; see Epic 8)
 */

import type { FSRSGrade, LemmaCard } from "../types";

export function updateCard(_card: LemmaCard, _grade: FSRSGrade): LemmaCard {
  throw new Error("TODO: Epic 8");
}
