/**
 * packages/plugins/src/catalog/sugarlang/runtime/placement/placement-score-engine.ts
 *
 * Purpose: Reserves the deterministic questionnaire scoring engine for placement.
 *
 * Exports:
 *   - PlacementScoreResult
 *   - PlacementScoreEngine
 *
 * Relationships:
 *   - Depends on the plugin-owned placement questionnaire assets.
 *   - Will be consumed by the placement flow orchestrator in Epic 11.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: skeleton (no implementation yet; see Epic 11)
 */

import type {
  PlacementQuestionnaire,
  PlacementQuestionnaireResponse,
  PlacementScoreResult
} from "../types";

export type { PlacementScoreResult } from "../types";

export class PlacementScoreEngine {
  scoreResponses(
    _responses: PlacementQuestionnaireResponse,
    _questionnaire: PlacementQuestionnaire
  ): PlacementScoreResult {
    throw new Error("TODO: Epic 11");
  }
}
