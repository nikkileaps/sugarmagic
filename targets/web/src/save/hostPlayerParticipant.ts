/**
 * targets/web/src/save/hostPlayerParticipant.ts
 *
 * Purpose: `host.player` SaveParticipant — the host-owned slice
 * that carries the player's spawn location (current region +
 * world-space position) across sessions. First real participant
 * to land under Plan 055's registry model; sets the pattern
 * follow-up participants (quest.manager, inventory.player,
 * world.presence) will mirror.
 *
 * Extracted from `runtimeHost.ts` to keep the participant
 * unit-testable in isolation: the factory takes accessor
 * callbacks so tests can drive it with a fake world + region
 * getter without standing up a full runtime host.
 *
 * Implements: Plan 055 §055.3
 *
 * Status: active
 */

import {
  PlayerControlled,
  Position,
  type SaveParticipant,
  type SaveSlice,
  type World
} from "@sugarmagic/runtime-core";

/**
 * The `host.player` slice shape. Kept in sync (by contract) with
 * `upgradeLegacyPayload` in `@sugarmagic/domain`, which synthesizes
 * this exact shape from pre-055 3-field legacy saves. Renaming a
 * field here without updating the legacy upgrader (or vice versa)
 * silently strands legacy saves.
 */
export interface HostPlayerSlice {
  currentRegionId: string | null;
  playerPosition: { x: number; y: number; z: number } | null;
  /**
   * Which way the player was facing, in radians.
   *
   * Yaw alone, because the character is upright: the per-frame velocity
   * heading only ever writes `root.rotation.y`, so pitch and roll would be
   * two fields that are always zero.
   *
   * Optional: a save written before this existed has none, and restores
   * facing the authored spawn direction, which is what it did then.
   */
  playerYaw?: number | null;
}

export interface HostPlayerParticipantDeps {
  /** Called at serialize time — returns the ECS world if one
   *  exists (null before `host.start` has spawned a world). */
  getWorld: () => World | null;
  /** Called at serialize time — returns the current region id
   *  as tracked by the runtime host closure. */
  getCurrentRegionId: () => string | null;
  /** Called at serialize time — the player's current yaw, or null before
   *  a player has been spawned. */
  getPlayerYaw: () => number | null;
  /** Called at deserialize time — hands the restored slice's
   *  data (or null when no slice was stored) back to the host
   *  so it can drive spawn resolution before world/player
   *  create. */
  applyRestoredSlice: (data: HostPlayerSlice | null) => void;
}

export const HOST_PLAYER_PARTICIPANT_ID = "host.player";
export const HOST_PLAYER_SLICE_SCHEMA_VERSION = 1;

export function createHostPlayerParticipant(
  deps: HostPlayerParticipantDeps
): SaveParticipant<HostPlayerSlice> {
  return {
    participantId: HOST_PLAYER_PARTICIPANT_ID,
    tier: "host-owned",
    schemaVersion: HOST_PLAYER_SLICE_SCHEMA_VERSION,
    serialize(): HostPlayerSlice {
      return {
        currentRegionId: deps.getCurrentRegionId(),
        playerPosition: readPlayerPosition(deps.getWorld()),
        playerYaw: deps.getPlayerYaw()
      };
    },
    deserialize(slice: SaveSlice<HostPlayerSlice> | null): void {
      deps.applyRestoredSlice(slice?.data ?? null);
    }
  };
}

function readPlayerPosition(
  world: World | null
): { x: number; y: number; z: number } | null {
  if (!world) return null;
  const entities = world.query(PlayerControlled, Position);
  if (entities.length === 0) return null;
  const pos = world.getComponent(entities[0]!, Position);
  if (!pos) return null;
  return { x: pos.x, y: pos.y, z: pos.z };
}
