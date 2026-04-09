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
 * Status: skeleton (no implementation yet; see Epic 3 and Epic 11)
 */

import type { CEFRBand } from "./learner-profile";
import type { LemmaRef } from "./lexical-prescription";

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

interface PlacementQuestionKindBase {
  questionId: string;
  targetBand: CEFRBand;
  promptText: string;
  supportText?: string;
}

export interface MultipleChoiceQuestion extends PlacementQuestionKindBase {
  kind: "multiple-choice";
  options: Array<{
    optionId: string;
    text: string;
    isCorrect: boolean;
  }>;
}

export interface FreeTextQuestion extends PlacementQuestionKindBase {
  kind: "free-text";
  expectedLemmas: string[];
  acceptableForms?: string[];
  minExpectedLength?: number;
}

export interface YesNoQuestion extends PlacementQuestionKindBase {
  kind: "yes-no";
  correctAnswer: "yes" | "no";
  yesLabel: string;
  noLabel: string;
}

export interface FillInBlankQuestion extends PlacementQuestionKindBase {
  kind: "fill-in-blank";
  sentenceTemplate: string;
  acceptableAnswers: string[];
  acceptableLemmas?: string[];
}

export type PlacementQuestionnaireQuestion =
  | MultipleChoiceQuestion
  | FreeTextQuestion
  | YesNoQuestion
  | FillInBlankQuestion;

export interface PlacementQuestionnaireResponse {
  questionnaireId: string;
  submittedAtMs: number;
  answers: Record<string, PlacementAnswer>;
}

export type PlacementAnswer =
  | { kind: "multiple-choice"; optionId: string }
  | { kind: "free-text"; text: string }
  | { kind: "yes-no"; answer: "yes" | "no" }
  | { kind: "fill-in-blank"; text: string }
  | { kind: "skipped" };

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

export type SugarlangPlacementFlowPhase =
  | "opening-dialog"
  | "questionnaire"
  | "closing-dialog"
  | "not-active";
