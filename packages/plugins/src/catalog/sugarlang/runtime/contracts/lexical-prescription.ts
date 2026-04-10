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
 * Status: active
 */

import type { LearnerProfile } from "./learner-profile";
import type {
  CompiledSceneLexicon,
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

/**
 * Turn-level lexical budget allocated by the Budgeter.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 */
export interface LexicalBudget {
  newItemsAllowed: number;
  turnSeconds?: number;
}

/**
 * Scored rationale entry for a candidate lemma.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 */
export interface LexicalPriorityScore {
  lemmaRef: LemmaRef;
  score: number;
  components?: {
    due: number;
    new: number;
    anchor: number;
    prodgap: number;
    lapse: number;
  };
  reasons: string[];
}

/**
 * Transparent reasoning trail for a generated lexical prescription.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 */
export interface LexicalRationale {
  summary?: string;
  candidateSetSize: number;
  envelopeSurvivorCount: number;
  priorityScores: LexicalPriorityScore[];
  reasons: string[];
  levelCap?: number;
  chosenIntroduce?: LemmaRef[];
  chosenReinforce?: LemmaRef[];
  droppedByEnvelope?: LemmaRef[];
  questEssentialExclusionLemmaIds?: string[];
}

/**
 * Raw Budgeter output that the Director reshapes but does not replace.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 */
export interface LexicalPrescription {
  introduce: LemmaRef[];
  reinforce: LemmaRef[];
  avoid: LemmaRef[];
  anchor?: LemmaRef;
  budget: LexicalBudget;
  rationale: LexicalRationale;
}

/**
 * Input contract for the Budgeter's prescribe step.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 */
export interface LexicalPrescriptionInput {
  learner: LearnerProfile;
  sceneLexicon: CompiledSceneLexicon;
  conversationState: Record<string, unknown>;
  activeQuestEssentialLemmas?: QuestEssentialLemma[];
}
