/**
 * packages/plugins/src/catalog/sugarlang/runtime/placement/placement-flow-orchestrator.ts
 *
 * Purpose: Reserves the placement flow state machine that coordinates opening dialog, questionnaire, and closing dialog.
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
 * Status: skeleton (no implementation yet; see Epic 11)
 */

import type { SugarlangPlacementFlowPhase } from "../types";

export type { SugarlangPlacementFlowPhase } from "../types";

export class PlacementFlowOrchestrator {
  getPhase(): SugarlangPlacementFlowPhase {
    throw new Error("TODO: Epic 11");
  }
}
