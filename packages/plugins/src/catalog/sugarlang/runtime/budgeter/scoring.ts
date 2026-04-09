/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/scoring.ts
 *
 * Purpose: Reserves the transparent lemma-priority scoring function used by the Budgeter.
 *
 * Exports:
 *   - computeLemmaPriority
 *
 * Relationships:
 *   - Depends on scene-lexicon and learner-profile contract types.
 *   - Will be consumed by LexicalBudgeter and rationale tracing in Epic 8.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: skeleton (no implementation yet; see Epic 8)
 */

import type {
  CompiledSceneLexicon,
  LearnerProfile,
  SceneLemmaInfo
} from "../types";

export function computeLemmaPriority(
  _lemma: SceneLemmaInfo,
  _learner: LearnerProfile,
  _sceneLexicon: CompiledSceneLexicon
): number {
  throw new Error("TODO: Epic 8");
}
