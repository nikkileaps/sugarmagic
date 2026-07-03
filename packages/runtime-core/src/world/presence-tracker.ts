/**
 * packages/runtime-core/src/world/presence-tracker.ts
 *
 * Purpose: `world.presence` tracker + SaveParticipant. Records
 * which item-presence IDs the player has collected, keyed by
 * region. On region load, the scene builder consults the tracker
 * via `shouldSkip(regionId, presenceId)` and skips already-
 * collected presences so they don't respawn.
 *
 * Boundary: this tracker is HOST-owned, not assembly-owned. The
 * assembly gets a shouldSkip callback pointer at construction;
 * the tracker itself outlives assembly rebuilds so its serialized
 * state stays authoritative across region transitions (once
 * mid-session transitions land — Story 47.10 follow-up).
 *
 * Tier: "region-aware". The tracker's deserialize must run
 * BEFORE `gameplayAssembly` is constructed (because that's when
 * `registerItemInteractables` reads shouldSkip). The runtime
 * host runs it in Phase 1 alongside `host.player`.
 *
 * Implements: Plan 055 §055.6
 *
 * Status: active
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";

export const WORLD_PRESENCE_PARTICIPANT_ID = "world.presence";
export const WORLD_PRESENCE_SLICE_SCHEMA_VERSION = 1;

/**
 * Persisted slice shape. Sets flatten to arrays for JSON.
 *
 * Design decision (revisit under Plan 058 Scenes):
 * currently Scene-agnostic. If a later Scene needs to un-
 * collect a presence in a shared region to re-story it, we bump
 * this to `Record<regionId, Record<sceneId, string[]>>` and
 * migrate. See Plan 055 open questions.
 */
export interface WorldPresenceSlice {
  collectedByRegion: Record<string, string[]>;
}

/**
 * Host-lifetime tracker of collected item presences. The
 * assembly's item-presence collection callback funnels into
 * `markCollected`; the assembly's scene setup consults
 * `shouldSkip` to skip already-collected presences.
 */
export class WorldPresenceTracker {
  private readonly collected = new Map<string, Set<string>>();

  markCollected(regionId: string | null, presenceId: string): void {
    if (!regionId) return;
    let set = this.collected.get(regionId);
    if (!set) {
      set = new Set();
      this.collected.set(regionId, set);
    }
    set.add(presenceId);
  }

  shouldSkip(regionId: string | null, presenceId: string): boolean {
    if (!regionId) return false;
    return this.collected.get(regionId)?.has(presenceId) ?? false;
  }

  /** Wipe every recorded collection. Used by `resetForNewGame`
   *  flows so a fresh save starts with everything spawnable. */
  reset(): void {
    this.collected.clear();
  }

  serializeSaveSlice(): WorldPresenceSlice {
    const collectedByRegion: Record<string, string[]> = {};
    for (const [regionId, set] of this.collected) {
      collectedByRegion[regionId] = Array.from(set);
    }
    return { collectedByRegion };
  }

  deserializeSaveSlice(slice: SaveSlice<WorldPresenceSlice> | null): void {
    this.collected.clear();
    if (!slice) return;
    for (const [regionId, ids] of Object.entries(
      slice.data.collectedByRegion ?? {}
    )) {
      this.collected.set(regionId, new Set(ids));
    }
  }
}

export interface WorldPresenceParticipantDeps {
  tracker: WorldPresenceTracker;
}

export function createWorldPresenceSaveParticipant(
  deps: WorldPresenceParticipantDeps
): SaveParticipant<WorldPresenceSlice> {
  return {
    participantId: WORLD_PRESENCE_PARTICIPANT_ID,
    tier: "region-aware",
    schemaVersion: WORLD_PRESENCE_SLICE_SCHEMA_VERSION,
    serialize(): WorldPresenceSlice {
      return deps.tracker.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<WorldPresenceSlice> | null): void {
      deps.tracker.deserializeSaveSlice(slice);
    }
  };
}
