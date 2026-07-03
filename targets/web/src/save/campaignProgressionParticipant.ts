/**
 * targets/web/src/save/campaignProgressionParticipant.ts
 *
 * Purpose: `campaign.progression` SaveParticipant — which Scene
 * the player is in, which Scenes gameplay has explicitly
 * unlocked, and which are completed. Plan 055 registry pattern
 * (sixth participant), Plan 058 §058.4.
 *
 * Tier is `host-owned`, NOT `default` as Plan 058 originally
 * sketched: `currentSceneId` decides which Scene overlay composes
 * the world, so it must restore in Phase 1 BEFORE spawn — the
 * same boot-ordering class as `host.player`'s `currentRegionId`.
 *
 * `unlockedSceneIds` stores only MANUAL unlocks (the
 * `unlockScene` action, Plan 058.5). Unlocks derivable from
 * conditions (always / questComplete / wallClock) are evaluated
 * fresh each boot via `resolveUnlockedSceneIds` — persisting them
 * would strand players when authors retune conditions.
 *
 * Implements: Plan 058 §058.4
 *
 * Status: active
 */

import type { SaveParticipant, SaveSlice } from "@sugarmagic/runtime-core";

export interface CampaignProgressionSlice {
  currentSceneId: string | null;
  /** Manual unlocks only — see header. */
  unlockedSceneIds: string[];
  completedSceneIds: string[];
}

export interface CampaignProgressionDeps {
  /** Serialize-time reads from the host's closures. */
  getCurrentSceneId: () => string | null;
  getManuallyUnlockedSceneIds: () => readonly string[];
  getCompletedSceneIds: () => readonly string[];
  /** Deserialize-time handoff to the host, Phase 1 (pre-spawn). */
  applyRestoredSlice: (data: CampaignProgressionSlice | null) => void;
}

export const CAMPAIGN_PROGRESSION_PARTICIPANT_ID = "campaign.progression";
export const CAMPAIGN_PROGRESSION_SLICE_SCHEMA_VERSION = 1;

export function createCampaignProgressionParticipant(
  deps: CampaignProgressionDeps
): SaveParticipant<CampaignProgressionSlice> {
  return {
    participantId: CAMPAIGN_PROGRESSION_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: CAMPAIGN_PROGRESSION_SLICE_SCHEMA_VERSION,
    serialize(): CampaignProgressionSlice {
      return {
        currentSceneId: deps.getCurrentSceneId(),
        unlockedSceneIds: [...deps.getManuallyUnlockedSceneIds()],
        completedSceneIds: [...deps.getCompletedSceneIds()]
      };
    },
    deserialize(slice: SaveSlice<CampaignProgressionSlice> | null): void {
      deps.applyRestoredSlice(slice?.data ?? null);
    }
  };
}
