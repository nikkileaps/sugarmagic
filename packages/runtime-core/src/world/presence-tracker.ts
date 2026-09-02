/**
 * packages/runtime-core/src/world/presence-tracker.ts
 *
 * Purpose: `world.presence` tracker + SaveParticipant. Records
 * which item-presence IDs the player has collected, keyed by
 * (region, Scene). On region load, the scene builder consults the
 * tracker via `shouldSkip(regionId, sceneId, presenceId)` and
 * skips already-collected presences so they don't respawn.
 *
 * Plan 058 §058.5 — v2 keys collections per Scene (Base + Overlay
 * applied to the save schema): the same region revisited in a
 * different Scene has its own collected set, so Scene 2 can
 * re-story a region without Scene 1's pickups bleeding through.
 * v1 slices (flat per-region arrays) upgrade at deserialize by
 * wrapping under the default Scene id.
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
 * Implements: Plan 055 §055.6, Plan 058 §058.5
 *
 * Status: active
 */

import { DEFAULT_SCENE_ID, type SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";

export const WORLD_PRESENCE_PARTICIPANT_ID = "world.presence";
export const WORLD_PRESENCE_SLICE_SCHEMA_VERSION = 3;

/**
 * Where collections go when no Scene is active -- a region entered with
 * nothing dressing it (epic #226).
 *
 * Deliberately NOT a `scene:` id, so it can never collide with a real
 * Scene: `createSceneId` mints `scene:<uuid>`, and the one literal Scene
 * id in the domain is `scene:default`. Before this, a null Scene filed
 * under `DEFAULT_SCENE_ID` -- which IS a real Scene in a live project, so
 * picking an item up with no Scene active also marked it collected in
 * that Scene, and the reverse.
 */
export const NO_SCENE_COLLECTION_BUCKET = "__no-scene__";

/**
 * Persisted slice shape. Sets flatten to arrays for JSON.
 *
 * v1 was `Record<regionId, string[]>` (Scene-agnostic); deserialize
 * upgrades it by wrapping each region's array under `DEFAULT_SCENE_ID` --
 * pre-Scenes saves were implicitly playing the default Scene.
 *
 * v2 -> v3 carries the data across UNCHANGED, deliberately. The shape is
 * identical; what changed is that a null Scene now files under
 * `NO_SCENE_COLLECTION_BUCKET` rather than `DEFAULT_SCENE_ID`. A v2 save
 * cannot say which of its `scene:default` entries were collected with no
 * Scene active, and re-keying them would move real Scene collections into
 * the free-roam bucket. Leaving them where the player earned them is the
 * answer that cannot be wrong; the version marks that a save was written
 * after the split.
 */
export interface WorldPresenceSlice {
  collectedByRegion: Record<string, Record<string, string[]>>;
}

interface WorldPresenceSliceV1 {
  collectedByRegion: Record<string, string[]>;
}

/**
 * Host-lifetime tracker of collected item presences. The
 * assembly's item-presence collection callback funnels into
 * `markCollected`; the assembly's scene setup consults
 * `shouldSkip` to skip already-collected presences.
 */
export class WorldPresenceTracker {
  /** regionId -> sceneId -> collected presence ids. */
  private readonly collected = new Map<string, Map<string, Set<string>>>();

  markCollected(
    regionId: string | null,
    sceneId: string | null,
    presenceId: string
  ): void {
    if (!regionId) return;
    const scene = sceneId ?? NO_SCENE_COLLECTION_BUCKET;
    let byScene = this.collected.get(regionId);
    if (!byScene) {
      byScene = new Map();
      this.collected.set(regionId, byScene);
    }
    let set = byScene.get(scene);
    if (!set) {
      set = new Set();
      byScene.set(scene, set);
    }
    set.add(presenceId);
  }

  shouldSkip(
    regionId: string | null,
    sceneId: string | null,
    presenceId: string
  ): boolean {
    if (!regionId) return false;
    const scene = sceneId ?? NO_SCENE_COLLECTION_BUCKET;
    return (
      this.collected.get(regionId)?.get(scene)?.has(presenceId) ?? false
    );
  }

  /** Wipe every recorded collection. Used by `resetForNewGame`
   *  flows so a fresh save starts with everything spawnable. */
  reset(): void {
    this.collected.clear();
  }

  serializeSaveSlice(): WorldPresenceSlice {
    const collectedByRegion: Record<string, Record<string, string[]>> = {};
    for (const [regionId, byScene] of this.collected) {
      const scenes: Record<string, string[]> = {};
      for (const [sceneId, set] of byScene) {
        scenes[sceneId] = Array.from(set);
      }
      collectedByRegion[regionId] = scenes;
    }
    return { collectedByRegion };
  }

  deserializeSaveSlice(slice: SaveSlice<WorldPresenceSlice> | null): void {
    this.collected.clear();
    if (!slice) return;
    if (slice.schemaVersion < 2) {
      // v1 -> v2: flat per-region arrays were written before
      // Scenes existed; those collections happened in what is now
      // the default Scene.
      const v1 = slice.data as unknown as WorldPresenceSliceV1;
      for (const [regionId, ids] of Object.entries(
        v1.collectedByRegion ?? {}
      )) {
        if (!Array.isArray(ids)) continue;
        this.collected.set(
          regionId,
          new Map([[DEFAULT_SCENE_ID, new Set(ids)]])
        );
      }
      return;
    }
    for (const [regionId, byScene] of Object.entries(
      slice.data.collectedByRegion ?? {}
    )) {
      const sceneMap = new Map<string, Set<string>>();
      for (const [sceneId, ids] of Object.entries(byScene ?? {})) {
        if (!Array.isArray(ids)) continue;
        sceneMap.set(sceneId, new Set(ids));
      }
      this.collected.set(regionId, sceneMap);
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
