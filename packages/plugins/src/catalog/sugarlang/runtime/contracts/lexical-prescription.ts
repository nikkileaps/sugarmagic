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
 *   - Is consumed by the Budgeter, Director, middleware, and telemetry stubs.
 *   - Depends on learner-profile and scene-lexicon contracts for its input shape.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: skeleton (no implementation yet; see Epic 3)
 */

import type { LearnerProfile } from "./learner-profile";
import type { CompiledSceneLexicon } from "./scene-lexicon";

export interface LemmaRef {
  lemmaId: string;
  surfaceForm?: string;
  lang: string;
}

export interface LexicalBudget {
  newItemsAllowed: number;
  turnSeconds?: number;
}

export interface LexicalRationale {
  candidateSetSize: number;
  envelopeSurvivorCount: number;
  priorityScores: Record<string, number>;
  reasons: string[];
}

export interface LexicalPrescription {
  introduce: LemmaRef[];
  reinforce: LemmaRef[];
  avoid: LemmaRef[];
  anchor?: LemmaRef;
  budget: LexicalBudget;
  rationale: LexicalRationale;
}

export interface LexicalPrescriptionInput {
  learner: LearnerProfile;
  sceneLexicon: CompiledSceneLexicon;
  conversationState: Record<string, unknown>;
}
