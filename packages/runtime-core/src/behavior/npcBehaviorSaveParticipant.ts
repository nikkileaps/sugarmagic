/**
 * packages/runtime-core/src/behavior/npcBehaviorSaveParticipant.ts
 *
 * Purpose: `npc.behavior` SaveParticipant factory. Bridges the
 * RuntimeNpcBehaviorSystem (created inside `gameplayAssembly`)
 * to the SaveParticipantRegistry (owned by the runtime host).
 * Same nullable-getter pattern as the other post-055 participants.
 *
 * Implements: Plan 056 §056.2
 *
 * Status: active
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type {
  NpcBehaviorSlice,
  RuntimeNpcBehaviorSystem
} from "./system";

export const NPC_BEHAVIOR_PARTICIPANT_ID = "npc.behavior";
export const NPC_BEHAVIOR_SLICE_SCHEMA_VERSION = 1;

export interface NpcBehaviorParticipantDeps {
  /** Returns the live NpcBehaviorSystem, or null when
   *  `gameplayAssembly` hasn't been constructed yet. */
  getNpcBehaviorSystem: () => RuntimeNpcBehaviorSystem | null;
}

function emptySlice(): NpcBehaviorSlice {
  return { npcs: {} };
}

export function createNpcBehaviorSaveParticipant(
  deps: NpcBehaviorParticipantDeps
): SaveParticipant<NpcBehaviorSlice> {
  return {
    participantId: NPC_BEHAVIOR_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: NPC_BEHAVIOR_SLICE_SCHEMA_VERSION,
    serialize(): NpcBehaviorSlice {
      const system = deps.getNpcBehaviorSystem();
      if (!system) return emptySlice();
      return system.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<NpcBehaviorSlice> | null): void {
      const system = deps.getNpcBehaviorSystem();
      if (!system) return;
      system.deserializeSaveSlice(slice);
    }
  };
}
