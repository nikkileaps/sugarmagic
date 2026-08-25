/**
 * targets/web/src/save/campaignProgressionParticipant.ts
 *
 * Purpose: `campaign.progression` SaveParticipant — where the
 * player is in the campaign, which Episodes gameplay has opened,
 * and what they have finished. Plan 055 registry pattern.
 *
 * Tier is `host-owned`, NOT `default`: `currentSceneId` decides
 * which Scene overlay composes the world, so it must restore in
 * Phase 1 BEFORE spawn — the same boot-ordering class as
 * `host.player`'s `currentRegionId`.
 *
 * `unlockedEpisodeIds` stores only MANUAL unlocks (the
 * `unlockEpisode` action, plus the Episode an advance moved
 * into). Gates that derive from state — always / questComplete /
 * wallClock — are evaluated fresh each boot by
 * `resolveUnlockedEpisodeIds`, because persisting them would
 * strand players when authors retune a gate.
 *
 * Status: active
 */

import type { SaveParticipant, SaveSlice } from "@sugarmagic/runtime-core";

export interface CampaignProgressionSlice {
  /** The Episode the player is in. */
  currentEpisodeId: string | null;
  /** The Scene the player is in, inside that Episode. */
  currentSceneId: string | null;
  /** Manual unlocks only — see header. */
  unlockedEpisodeIds: string[];
  completedSceneIds: string[];
  completedEpisodeIds: string[];
}

export interface CampaignProgressionDeps {
  /** Serialize-time reads from the host's closures. */
  getCurrentEpisodeId: () => string | null;
  getCurrentSceneId: () => string | null;
  getManuallyUnlockedEpisodeIds: () => readonly string[];
  getCompletedSceneIds: () => readonly string[];
  getCompletedEpisodeIds: () => readonly string[];
  /** Deserialize-time handoff to the host, Phase 1 (pre-spawn). */
  applyRestoredSlice: (data: CampaignProgressionSlice | null) => void;
}

export const CAMPAIGN_PROGRESSION_PARTICIPANT_ID = "campaign.progression";

/**
 * v2 — Episodes. v1 was Scene-shaped (`unlockedSceneIds`,
 * `currentSceneId` with no Episode above it) and is DISCARDED
 * rather than upgraded: Scenes stopped being gated, so v1's
 * unlocked set has no v2 meaning to convert into.
 *
 * A player on a v1 save keeps everything else — quests,
 * inventory, world flags, world time, known facts, NPC behavior,
 * caster stats — and restarts the campaign from its first Scene.
 * The precedent is `teach-plan-state`'s discard-on-version-miss,
 * not `world.presence`'s v1 -> v2 in-place upgrade.
 */
export const CAMPAIGN_PROGRESSION_SLICE_SCHEMA_VERSION = 2;

export function createCampaignProgressionParticipant(
  deps: CampaignProgressionDeps
): SaveParticipant<CampaignProgressionSlice> {
  return {
    participantId: CAMPAIGN_PROGRESSION_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: CAMPAIGN_PROGRESSION_SLICE_SCHEMA_VERSION,
    serialize(): CampaignProgressionSlice {
      return {
        currentEpisodeId: deps.getCurrentEpisodeId(),
        currentSceneId: deps.getCurrentSceneId(),
        unlockedEpisodeIds: [...deps.getManuallyUnlockedEpisodeIds()],
        completedSceneIds: [...deps.getCompletedSceneIds()],
        completedEpisodeIds: [...deps.getCompletedEpisodeIds()]
      };
    },
    deserialize(slice: SaveSlice<CampaignProgressionSlice> | null): void {
      if (
        slice &&
        slice.schemaVersion < CAMPAIGN_PROGRESSION_SLICE_SCHEMA_VERSION
      ) {
        console.info(
          "[web-runtime] Discarding a pre-Episodes campaign.progression slice; " +
            "the campaign restarts from its first Scene. Everything else in " +
            "the save is untouched."
        );
        deps.applyRestoredSlice(null);
        return;
      }
      deps.applyRestoredSlice(slice?.data ?? null);
    }
  };
}
