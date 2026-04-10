/**
 * packages/plugins/src/catalog/sugarlang/runtime/quest-integration/quest-adapter.ts
 *
 * Purpose: Owns the thin action-proposal wrapper used by Sugarlang's placement capability.
 *
 * Exports:
 *   - setSugarlangQuestFlag
 *   - notifySugarlangQuestEvent
 *
 * Relationships:
 *   - Will be consumed by the placement completion path once Epic 11 lands.
 *   - Keeps quest integration isolated from the rest of the plugin runtime.
 *
 * Implements: Proposal 001 §Placement Interaction Contract
 *
 * Status: active
 */

import type { ConversationActionProposal } from "@sugarmagic/runtime-core";

export function setSugarlangQuestFlag(
  key: string,
  value: string
): ConversationActionProposal {
  return {
    kind: "set-conversation-flag",
    key,
    value
  };
}

export function notifySugarlangQuestEvent(
  eventName: string
): ConversationActionProposal {
  return {
    kind: "notify-quest-event",
    eventName
  };
}
