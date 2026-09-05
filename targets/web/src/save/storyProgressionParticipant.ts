/**
 * targets/web/src/save/storyProgressionParticipant.ts
 *
 * Purpose: the story-progression SaveParticipant — where the
 * player is in the story, and which Episodes gameplay has opened.
 * Plan 055 registry pattern.
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

export interface StoryProgressionSlice {
  /** The Episode the player is in. */
  currentEpisodeId: string | null;
  /** The Scene the player is in, inside that Episode. */
  currentSceneId: string | null;
  /** Manual unlocks only — see header. */
  unlockedEpisodeIds: string[];
}

export interface StoryProgressionDeps {
  /** Serialize-time reads from the host's closures. */
  getCurrentEpisodeId: () => string | null;
  getCurrentSceneId: () => string | null;
  getManuallyUnlockedEpisodeIds: () => readonly string[];
  /** Deserialize-time handoff to the host, Phase 1 (pre-spawn). */
  applyRestoredSlice: (data: StoryProgressionSlice | null) => void;
}

/**
 * The key this participant's slice is stored under, inside every
 * save file that already exists.
 *
 * The VALUE is a wire name, not a domain term. "Campaign" is not a
 * word in this domain -- the tiers are game, Season, Episode,
 * Scene, quest -- but the string is what a saved game holds, so
 * changing it silently drops a player's position. It moves in its
 * own change, with a read-both migration; see #313.
 */
export const STORY_PROGRESSION_PARTICIPANT_ID = "campaign.progression";

/**
 * v2 — Episodes. v1 was Scene-shaped (`unlockedSceneIds`,
 * `currentSceneId` with no Episode above it) and is DISCARDED
 * rather than upgraded: Scenes stopped being gated, so v1's
 * unlocked set has no v2 meaning to convert into.
 *
 * A player on a v1 save keeps everything else — quests,
 * inventory, world flags, world time, known facts, NPC behavior,
 * caster stats — and restarts the story from its first Scene.
 * The precedent is `teach-plan-state`'s discard-on-version-miss,
 * not `world.presence`'s v1 -> v2 in-place upgrade.
 */
export const STORY_PROGRESSION_SLICE_SCHEMA_VERSION = 2;

export function createStoryProgressionParticipant(
  deps: StoryProgressionDeps
): SaveParticipant<StoryProgressionSlice> {
  return {
    participantId: STORY_PROGRESSION_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: STORY_PROGRESSION_SLICE_SCHEMA_VERSION,
    serialize(): StoryProgressionSlice {
      return {
        currentEpisodeId: deps.getCurrentEpisodeId(),
        currentSceneId: deps.getCurrentSceneId(),
        unlockedEpisodeIds: [...deps.getManuallyUnlockedEpisodeIds()]
      };
    },
    deserialize(slice: SaveSlice<StoryProgressionSlice> | null): void {
      if (
        slice &&
        slice.schemaVersion < STORY_PROGRESSION_SLICE_SCHEMA_VERSION
      ) {
        console.info(
          `[web-runtime] Discarding a pre-Episodes ${STORY_PROGRESSION_PARTICIPANT_ID} ` +
            "slice; the story restarts from its first Scene. Everything else " +
            "in the save is untouched."
        );
        deps.applyRestoredSlice(null);
        return;
      }
      deps.applyRestoredSlice(slice?.data ?? null);
    }
  };
}

/**
 * The former names, kept so anything still importing them keeps
 * working while the rename spreads. Nothing in this repo uses
 * them; they exist for a consumer outside it and go away with
 * #313.
 *
 * @deprecated Use the `StoryProgression` names above.
 */
export const CAMPAIGN_PROGRESSION_PARTICIPANT_ID =
  STORY_PROGRESSION_PARTICIPANT_ID;
/** @deprecated Use `STORY_PROGRESSION_SLICE_SCHEMA_VERSION`. */
export const CAMPAIGN_PROGRESSION_SLICE_SCHEMA_VERSION =
  STORY_PROGRESSION_SLICE_SCHEMA_VERSION;
/** @deprecated Use `StoryProgressionSlice`. */
export type CampaignProgressionSlice = StoryProgressionSlice;
/** @deprecated Use `createStoryProgressionParticipant`. */
export const createCampaignProgressionParticipant =
  createStoryProgressionParticipant;
