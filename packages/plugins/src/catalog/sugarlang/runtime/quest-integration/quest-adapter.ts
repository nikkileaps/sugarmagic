/**
 * packages/plugins/src/catalog/sugarlang/runtime/quest-integration/quest-adapter.ts
 *
 * Purpose: Reserves the thin quest-manager wrapper used by the placement capability.
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
 * Status: skeleton (no implementation yet; see Epic 11)
 */

export function setSugarlangQuestFlag(
  _key: string,
  _value: string
): void {
  throw new Error("TODO: Epic 11");
}

export function notifySugarlangQuestEvent(_eventName: string): void {
  throw new Error("TODO: Epic 11");
}
