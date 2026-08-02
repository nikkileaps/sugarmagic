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
  PlacementQuestionnaire
} from "../types";
import type { PlacementCompletionEvent } from "../learner";

export type { SugarlangPlacementFlowPhase } from "../types";

export function getPlacementQuestionnaireVersion(
  questionnaire: PlacementQuestionnaire
): string {
  return `${questionnaire.lang}-placement-v${questionnaire.schemaVersion}`;
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
