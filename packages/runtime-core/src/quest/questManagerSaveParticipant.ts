/**
 * packages/runtime-core/src/quest/questManagerSaveParticipant.ts
 *
 * Purpose: `quest.manager` SaveParticipant factory. Bridges the
 * QuestManager class (whose lifetime is tied to
 * `gameplayAssembly`) to the SaveParticipantRegistry (whose
 * lifetime is the runtime host). Because the QuestManager
 * doesn't exist until partway through `host.start`, the factory
 * takes a nullable getter — the participant tolerates being
 * called before the assembly is ready by returning an empty
 * slice (serialize) or no-op'ing (deserialize).
 *
 * Implements: Plan 055 §055.4
 *
 * Status: active
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type { QuestManager, QuestManagerSlice } from "./QuestManager";

export const QUEST_MANAGER_PARTICIPANT_ID = "quest.manager";
export const QUEST_MANAGER_SLICE_SCHEMA_VERSION = 1;

export interface QuestManagerParticipantDeps {
  /** Returns the live QuestManager, or null when
   *  `gameplayAssembly` hasn't been constructed yet. Participant
   *  gracefully no-op's serialize / deserialize in the null case
   *  so registration timing is decoupled from readiness. */
  getQuestManager: () => QuestManager | null;
}

function emptySlice(): QuestManagerSlice {
  return {
    activeQuests: {},
    completedQuestIds: [],
    trackedQuestDefinitionId: null,
    runtimeFlags: {}
  };
}

export function createQuestManagerSaveParticipant(
  deps: QuestManagerParticipantDeps
): SaveParticipant<QuestManagerSlice> {
  return {
    participantId: QUEST_MANAGER_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: QUEST_MANAGER_SLICE_SCHEMA_VERSION,
    serialize(): QuestManagerSlice {
      const manager = deps.getQuestManager();
      if (!manager) return emptySlice();
      return manager.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<QuestManagerSlice> | null): void {
      const manager = deps.getQuestManager();
      if (!manager) return;
      manager.deserializeSaveSlice(slice);
    }
  };
}
