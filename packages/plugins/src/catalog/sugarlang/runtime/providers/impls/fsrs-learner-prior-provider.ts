/**
 * packages/plugins/src/catalog/sugarlang/runtime/providers/impls/fsrs-learner-prior-provider.ts
 *
 * Purpose: Reserves the learner-prior provider that seeds FSRS-aligned lemma cards.
 *
 * Exports:
 *   - FsrsLearnerPriorProvider
 *
 * Relationships:
 *   - Implements the LearnerPriorProvider contract.
 *   - Will be consumed by learner seeding and Budgeter work in Epic 7 and Epic 8.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / ADR 010 provider boundaries
 *
 * Status: skeleton (no implementation yet; see Epic 7 and Epic 8)
 */

import type {
  LearnerPriorProvider,
  LearnerProfile,
  LemmaCard,
  LemmaRef
} from "../../types";

export class FsrsLearnerPriorProvider implements LearnerPriorProvider {
  buildInitialCard(
    _lemmaRef: LemmaRef,
    _learner: LearnerProfile
  ): LemmaCard {
    throw new Error("TODO: Epic 7/8");
  }
}
