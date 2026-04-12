/**
 * packages/plugins/src/catalog/sugarlang/runtime/quest-integration/placement-completion.ts
 *
 * Purpose: Builds the quest/action side effects emitted when Sugarlang placement completes.
 *
 * Exports:
 *   - emitPlacementCompleted
 *
 * Relationships:
 *   - Will be consumed by the placement flow orchestrator and quest adapter once Epic 11 lands.
 *   - Feeds Blackboard fact updates and quest completion signals.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import type { ConversationActionProposal } from "@sugarmagic/runtime-core";
import type { PlacementScoreResult } from "../types";
import {
  notifySugarlangQuestEvent,
  setSugarlangQuestFlag
} from "./quest-adapter";

export const SUGARLANG_PLACEMENT_COMPLETED_FLAG =
  "sugarlang.placement.status";
export const SUGARLANG_PLACEMENT_COMPLETED_EVENT =
  "sugarlang.placement.completed";

export function emitPlacementCompleted(
  scoreResult: PlacementScoreResult
): ConversationActionProposal[] {
  return [
    setSugarlangQuestFlag(SUGARLANG_PLACEMENT_COMPLETED_FLAG, "completed"),
    setSugarlangQuestFlag("sugarlang.placement.cefrBand", scoreResult.cefrBand),
    setSugarlangQuestFlag(
      "sugarlang.placement.confidence",
      String(scoreResult.confidence)
    ),
    notifySugarlangQuestEvent(SUGARLANG_PLACEMENT_COMPLETED_EVENT)
  ];
}
