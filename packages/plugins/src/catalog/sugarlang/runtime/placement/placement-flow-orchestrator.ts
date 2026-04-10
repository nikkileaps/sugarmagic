/**
 * packages/plugins/src/catalog/sugarlang/runtime/placement/placement-flow-orchestrator.ts
 *
 * Purpose: Owns the pure placement flow state machine and completion helpers.
 *
 * Exports:
 *   - PlacementFlowPhase
 *   - PlacementFlowOrchestrator
 *
 * Relationships:
 *   - Depends on the placement score engine and questionnaire loader.
 *   - Will be consumed by the context middleware and placement UI in Epic 11.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import type {
  LearnerProfile,
  PlacementScoreResult,
  PlacementQuestionnaire,
  SugarlangPlacementFlowPhase
} from "../types";
import type { PlacementCompletionEvent } from "../learner/learner-state-reducer";

export type { SugarlangPlacementFlowPhase } from "../types";

export interface PlacementPhaseStateValue {
  phase: Exclude<SugarlangPlacementFlowPhase, "not-active">;
  enteredAtTurn: number;
}

export interface PlacementPhaseTransitionInput {
  currentPhase: SugarlangPlacementFlowPhase;
  currentTurnCount: number;
  openingDialogTurns: number;
  closingDialogTurns: number;
  questionnaireSubmitted: boolean;
}

export function getPlacementQuestionnaireVersion(
  questionnaire: PlacementQuestionnaire
): string {
  return `${questionnaire.lang}-placement-v${questionnaire.schemaVersion}`;
}

export function advancePlacementPhase(
  input: PlacementPhaseTransitionInput
): SugarlangPlacementFlowPhase {
  switch (input.currentPhase) {
    case "not-active":
      return "opening-dialog";
    case "opening-dialog":
      return input.currentTurnCount >= input.openingDialogTurns
        ? "questionnaire"
        : "opening-dialog";
    case "questionnaire":
      return input.questionnaireSubmitted ? "closing-dialog" : "questionnaire";
    case "closing-dialog":
      return input.currentTurnCount >= input.closingDialogTurns
        ? "not-active"
        : "closing-dialog";
    default: {
      const exhaustive: never = input.currentPhase;
      return exhaustive;
    }
  }
}

export function buildPlacementCompletionEvent(
  scoreResult: PlacementScoreResult,
  _learnerProfile: LearnerProfile
): PlacementCompletionEvent {
  return {
    type: "placement-completion",
    cefrBand: scoreResult.cefrBand,
    confidence: scoreResult.confidence,
    completedAtMs: scoreResult.scoredAtMs,
    lemmasSeededFromFreeText: scoreResult.lemmasSeededFromFreeText
  };
}

export class PlacementFlowOrchestrator {
  getPhase(input: PlacementPhaseTransitionInput): SugarlangPlacementFlowPhase {
    return advancePlacementPhase(input);
  }
}
