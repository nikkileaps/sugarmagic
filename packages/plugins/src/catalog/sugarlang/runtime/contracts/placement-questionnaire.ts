/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/placement-questionnaire.ts
 *
 * Purpose: Declares the plugin-owned placement questionnaire, response, and scoring contract types.
 *
 * Exports:
 *   - PlacementQuestionnaire
 *   - PlacementQuestionnaireQuestion
 *   - MultipleChoiceQuestion
 *   - FreeTextQuestion
 *   - YesNoQuestion
 *   - FillInBlankQuestion
 *   - PlacementQuestionnaireResponse
 *   - PlacementAnswer
 *   - PlacementScoreResult
 *   - SugarlangPlacementFlowPhase
 *
 * Relationships:
 *   - Depends on learner-profile and lexical-prescription contract types.
 *   - Is consumed by placement runtime systems, placement UI, and Epic 11 quest integration.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import type { CEFRBand } from "./learner-profile";
import type { LemmaRef } from "./lexical-prescription";

/**
 * Top-level plugin-owned placement questionnaire shape for one target language.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface PlacementQuestionnaire {
  schemaVersion: 1;
  lang: string;
  targetLanguage: string;
  supportLanguage: string;
  formTitle: string;
  formIntro: string;
  questions: PlacementQuestionnaireQuestion[];
  minAnswersForValid: number;
}

/**
 * Shared fields for every questionnaire item kind.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface PlacementQuestionKindBase {
  questionId: string;
  targetBand: CEFRBand;
  promptText: string;
  supportText?: string;
}

/**
 * Multiple-choice placement item.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface MultipleChoiceQuestion extends PlacementQuestionKindBase {
  kind: "multiple-choice";
  options: Array<{
    optionId: string;
    text: string;
    isCorrect: boolean;
  }>;
}

/**
 * Free-text placement item.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface FreeTextQuestion extends PlacementQuestionKindBase {
  kind: "free-text";
  expectedLemmas: string[];
  acceptableForms?: string[];
  minExpectedLength?: number;
}

/**
 * Yes/no placement item.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface YesNoQuestion extends PlacementQuestionKindBase {
  kind: "yes-no";
  correctAnswer: "yes" | "no";
  yesLabel: string;
  noLabel: string;
}

/**
 * Fill-in-the-blank placement item.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface FillInBlankQuestion extends PlacementQuestionKindBase {
  kind: "fill-in-blank";
  sentenceTemplate: string;
  acceptableAnswers: string[];
  acceptableLemmas?: string[];
}

/**
 * Discriminated union over all supported placement question kinds.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export type PlacementQuestionnaireQuestion =
  | MultipleChoiceQuestion
  | FreeTextQuestion
  | YesNoQuestion
  | FillInBlankQuestion;

/**
 * Player-submitted placement questionnaire response payload.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface PlacementQuestionnaireResponse {
  questionnaireId: string;
  submittedAtMs: number;
  answers: Record<string, PlacementAnswer>;
}

/**
 * Discriminated union over all placement answer payloads.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export type PlacementAnswer =
  | { kind: "multiple-choice"; optionId: string }
  | { kind: "free-text"; text: string }
  | { kind: "yes-no"; answer: "yes" | "no" }
  | { kind: "fill-in-blank"; text: string }
  | { kind: "skipped" };

/**
 * Deterministic placement scoring output.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export interface PlacementScoreResult {
  cefrBand: CEFRBand;
  confidence: number;
  perBandScores: Record<CEFRBand, { correct: number; total: number }>;
  lemmasSeededFromFreeText: LemmaRef[];
  skippedCount: number;
  totalCount: number;
  scoredAtMs: number;
  questionnaireVersion: string;
}

/**
 * Placement sub-state machine phase for a placement-tagged NPC conversation.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 */
export type SugarlangPlacementFlowPhase =
  | "opening-dialog"
  | "questionnaire"
  | "closing-dialog"
  | "not-active";
