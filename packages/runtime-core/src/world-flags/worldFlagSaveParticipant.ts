/**
 * `world.flags` SaveParticipant factory.
 *
 * Same shape and same reason as `questManagerSaveParticipant`: the manager's
 * lifetime is the gameplay assembly, the registry's is the runtime host, so the
 * factory takes a nullable getter and no-ops before the assembly exists.
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type { WorldFlagManager, WorldFlagSlice } from "./WorldFlagManager";

export const WORLD_FLAG_PARTICIPANT_ID = "world.flags";
export const WORLD_FLAG_SLICE_SCHEMA_VERSION = 1;

export interface WorldFlagParticipantDeps {
  /** The live manager, or null before the gameplay assembly is built. */
  getWorldFlagManager: () => WorldFlagManager | null;
}

export function createWorldFlagSaveParticipant(
  deps: WorldFlagParticipantDeps
): SaveParticipant<WorldFlagSlice> {
  return {
    participantId: WORLD_FLAG_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: WORLD_FLAG_SLICE_SCHEMA_VERSION,
    serialize(): WorldFlagSlice {
      const manager = deps.getWorldFlagManager();
      if (!manager) return { worldFlags: {} };
      return manager.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<WorldFlagSlice> | null): void {
      const manager = deps.getWorldFlagManager();
      if (!manager) return;
      manager.deserializeSaveSlice(slice);
    }
  };
}
