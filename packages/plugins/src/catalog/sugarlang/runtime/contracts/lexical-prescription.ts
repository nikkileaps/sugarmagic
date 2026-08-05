/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/lexical-prescription.ts
 *
 * Purpose: Declares the lexical prescription types owned by the Lexical Budgeter.
 *
 * Exports:
 *   - LemmaRef
 *   - LexicalBudget
 *   - LexicalRationale
 *   - LexicalPrescription
 *   - LexicalPrescriptionInput
 *
 * Relationships:
 *   - Is consumed by the Budgeter, Teacher, middleware, and telemetry stubs.
 *   - Depends on learner-profile and scene-lexicon contracts for its input shape.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import type { LearnerProfile } from "../learner";
import type {
  SceneVocabularyModel,
  QuestEssentialLemma
} from "./scene-lexicon";

/**
 * Lightweight lemma reference passed between sugarlang subsystems.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 */
export interface LemmaRef {
  lemmaId: string;
  surfaceForm?: string;
  lang: string;
}

// 090.5: `LexicalPrescription`, `LexicalPrescriptionInput`, `LexicalBudget`,
// `LexicalPriorityScore` and `LexicalRationale` all DELETED. 090.10 removed the
// budgeter that produced them; these outlived it as types nothing could build
// and nothing read. `LemmaRef` above is the only survivor -- it was always a
// general-purpose reference that happened to live in this file.
