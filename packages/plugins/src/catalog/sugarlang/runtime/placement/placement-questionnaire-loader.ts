/**
 * packages/plugins/src/catalog/sugarlang/runtime/placement/placement-questionnaire-loader.ts
 *
 * Purpose: Reserves the loader for plugin-shipped placement questionnaire assets.
 *
 * Exports:
 *   - loadPlacementQuestionnaire
 *
 * Relationships:
 *   - Will read data/languages/<lang>/placement-questionnaire.json once Epic 4 and Epic 11 land.
 *   - Will be consumed by the placement flow orchestrator.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: skeleton (no implementation yet; see Epic 4 and Epic 11)
 */

import type { PlacementQuestionnaire } from "../types";

export function loadPlacementQuestionnaire(
  _lang: string
): PlacementQuestionnaire {
  throw new Error("TODO: Epic 4/11");
}
