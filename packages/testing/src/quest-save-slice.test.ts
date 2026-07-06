/**
 * packages/testing/src/quest-save-slice.test.ts
 *
 * Purpose: Verifies the quest.manager save-participant pipeline —
 * QuestManager serialize/deserialize round-trip preserves active
 * quest stage/node progress, completed quest history, tracked
 * quest, and runtime flags; participant factory forwards through
 * the getter correctly and tolerates null (unset) QuestManager;
 * legacy 3-field save shape upgrades cleanly.
 *
 * Implements: Plan 055 §055.4 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition
} from "@sugarmagic/domain";
import {
  QuestManager,
  createQuestManagerSaveParticipant
} from "@sugarmagic/runtime-core";
import type {
  QuestManagerSlice,
  SaveSlice
} from "@sugarmagic/runtime-core";

function buildSingleStageQuest(id: string, displayName: string) {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          displayName: "Objective A",
          description: "Do the thing",
          objectiveSubtype: "custom"
        })
      },
      {
        ...createDefaultQuestNodeDefinition({
          displayName: "Objective B",
          description: "Do the other thing",
          objectiveSubtype: "custom"
        })
      }
    ]
  });
  const quest = createDefaultQuestDefinition({
    definitionId: id,
    displayName
  });
  return {
    ...quest,
    startStageId: stage.stageId,
    stageDefinitions: [stage]
  };
}

describe("QuestManager save slice", () => {
  describe("serialize / deserialize round-trip", () => {
    it("preserves active quest progress across a round-trip", () => {
      const quest = buildSingleStageQuest(
        "quest:round-trip",
        "Round Trip Test"
      );
      const source = new QuestManager();
      source.registerDefinitions([quest]);
      source.startQuest("quest:round-trip");
      source.setFlag("has-been-here", true);

      const slice = source.serializeSaveSlice();

      const restored = new QuestManager();
      restored.registerDefinitions([quest]);
      restored.deserializeSaveSlice({ schemaVersion: 1, data: slice });

      expect(restored.isQuestActive("quest:round-trip")).toBe(true);
      expect(restored.hasFlag("has-been-here", true)).toBe(true);
      expect(restored.serializeSaveSlice()).toEqual(slice);
    });

    it("preserves completed quest history and tracked quest across a round-trip", () => {
      const quest1 = buildSingleStageQuest("quest:done", "Done");
      const quest2 = buildSingleStageQuest("quest:tracking", "Tracking");
      const source = new QuestManager();
      source.registerDefinitions([quest1, quest2]);
      // Simulate completing quest:done by populating internals
      // via serialize/deserialize (avoids depending on quest node
      // completion mechanics for this test).
      source.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          activeQuests: {},
          completedQuestIds: ["quest:done"],
          trackedQuestDefinitionId: "quest:tracking",
          runtimeFlags: {}
        }
      });

      const slice = source.serializeSaveSlice();

      const restored = new QuestManager();
      restored.registerDefinitions([quest1, quest2]);
      restored.deserializeSaveSlice({ schemaVersion: 1, data: slice });

      expect(restored.isQuestCompleted("quest:done")).toBe(true);
      // trackedQuestDefinitionId survives even when the tracked
      // quest isn't in activeQuests yet — startInitialQuests will
      // pick it up.
      expect(restored.serializeSaveSlice().trackedQuestDefinitionId).toBe(
        "quest:tracking"
      );
    });

    it("returns an empty slice for a fresh manager", () => {
      const manager = new QuestManager();
      expect(manager.serializeSaveSlice()).toEqual({
        activeQuests: {},
        completedQuestIds: [],
        trackedQuestDefinitionId: null,
        runtimeFlags: {}
      });
    });

    // 2026-07-05 regression — restored quest state must resync
    // every derived consumer (NPC interactable availability, quest
    // tracker, blackboard facts). deserializeSaveSlice used to
    // mutate silently; consumers registered before the restore
    // (NPC interactables spawn pre-deserialize) stayed frozen at
    // empty-quest-state values, killing the talk prompt after
    // Continue.
    it("deserialize fires the state-change handler exactly like live mutation does", () => {
      const source = new QuestManager();
      const quest = buildSingleStageQuest("quest:notify", "Notify");
      source.registerDefinitions([quest]);
      source.startQuest("quest:notify");

      const restored = new QuestManager();
      restored.registerDefinitions([quest]);
      let stateChanges = 0;
      restored.setStateChangeHandler(() => {
        stateChanges += 1;
      });
      restored.deserializeSaveSlice({
        schemaVersion: 1,
        data: source.serializeSaveSlice()
      });
      expect(stateChanges).toBe(1);
      // null slice = fresh player = nothing changed = no ping.
      const fresh = new QuestManager();
      fresh.setStateChangeHandler(() => {
        throw new Error("state-change must not fire for a null slice");
      });
      fresh.deserializeSaveSlice(null);
    });

    it("talk-objective dialogue override survives the round-trip (the E-prompt source)", () => {
      const talkNode = {
        ...createDefaultQuestNodeDefinition({
          displayName: "Talk to Testy",
          objectiveSubtype: "talk"
        }),
        targetId: "npc:testy",
        dialogueDefinitionId: "dlg:testy-quest"
      };
      const stage = createDefaultQuestStageDefinition({
        nodeDefinitions: [talkNode]
      });
      const base = createDefaultQuestDefinition({
        definitionId: "quest:talk",
        displayName: "Talk"
      });
      const quest = {
        ...base,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      };

      const source = new QuestManager();
      source.registerDefinitions([quest]);
      source.startQuest("quest:talk");
      expect(source.getDialogueOverrideForNpc("npc:testy")).toBe(
        "dlg:testy-quest"
      );

      const restored = new QuestManager();
      restored.registerDefinitions([quest]);
      restored.deserializeSaveSlice({
        schemaVersion: 1,
        data: source.serializeSaveSlice()
      });
      // startInitialQuests short-circuits on the restored quest...
      expect(restored.startQuest("quest:talk")).toBe(false);
      // ...and the override (what lights the E prompt) is intact.
      expect(restored.getDialogueOverrideForNpc("npc:testy")).toBe(
        "dlg:testy-quest"
      );
    });
  });

  describe("legacy shape", () => {
    it("legacy slice ({trackedQuestDefinitionId only}) sets tracked and leaves rest empty", () => {
      const manager = new QuestManager();
      const quest = buildSingleStageQuest("quest:legacy", "Legacy");
      manager.registerDefinitions([quest]);

      // upgradeLegacyPayload produces this shape from a pre-055
      // save that only had `currentQuestId`.
      manager.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          activeQuests: {},
          completedQuestIds: [],
          trackedQuestDefinitionId: "quest:legacy",
          runtimeFlags: {}
        }
      });

      const post = manager.serializeSaveSlice();
      expect(post.trackedQuestDefinitionId).toBe("quest:legacy");
      expect(post.activeQuests).toEqual({});
      expect(post.completedQuestIds).toEqual([]);
      // Now if the runtime calls startInitialQuests, the manager
      // will fresh-start quest:legacy. That path isn't exercised
      // here — this test just proves the legacy shape upgrades
      // without exploding.
      expect(manager.startQuest("quest:legacy")).toBe(true);
    });
  });

  describe("null / fresh player", () => {
    it("deserialize(null) is a no-op — manager stays empty", () => {
      const manager = new QuestManager();
      manager.deserializeSaveSlice(null);
      expect(manager.serializeSaveSlice()).toEqual({
        activeQuests: {},
        completedQuestIds: [],
        trackedQuestDefinitionId: null,
        runtimeFlags: {}
      });
    });
  });

  describe("tolerance", () => {
    it("drops active quests whose definition isn't loaded, with a warning", () => {
      const manager = new QuestManager();
      const known = buildSingleStageQuest("quest:known", "Known");
      manager.registerDefinitions([known]);

      // Build a slice that references a stale/renamed quest id
      const knownStageId = known.stageDefinitions[0]!.stageId;
      const slice: QuestManagerSlice = {
        activeQuests: {
          "quest:known": {
            questDefinitionId: "quest:known",
            currentStageId: knownStageId,
            stageProgress: {}
          },
          "quest:stale": {
            questDefinitionId: "quest:stale",
            currentStageId: "stage:whatever",
            stageProgress: {}
          }
        },
        completedQuestIds: [],
        trackedQuestDefinitionId: null,
        runtimeFlags: {}
      };
      // Silence the expected warn so it doesn't pollute output.
      const originalWarn = console.warn;
      console.warn = () => {};
      try {
        manager.deserializeSaveSlice({ schemaVersion: 1, data: slice });
      } finally {
        console.warn = originalWarn;
      }

      const restored = manager.serializeSaveSlice();
      expect(Object.keys(restored.activeQuests)).toEqual(["quest:known"]);
    });
  });
});

describe("createQuestManagerSaveParticipant", () => {
  it("declares participantId, tier, schemaVersion per the contract", () => {
    const p = createQuestManagerSaveParticipant({
      getQuestManager: () => null
    });
    expect(p.participantId).toBe("quest.manager");
    expect(p.tier).toBe("default");
    expect(p.schemaVersion).toBe(1);
  });

  it("serialize returns an empty slice when the getter yields null", () => {
    const p = createQuestManagerSaveParticipant({
      getQuestManager: () => null
    });
    expect(p.serialize()).toEqual({
      activeQuests: {},
      completedQuestIds: [],
      trackedQuestDefinitionId: null,
      runtimeFlags: {}
    });
  });

  it("serialize forwards to the manager when available", () => {
    const manager = new QuestManager();
    manager.deserializeSaveSlice({
      schemaVersion: 1,
      data: {
        activeQuests: {},
        completedQuestIds: ["quest:x"],
        trackedQuestDefinitionId: null,
        runtimeFlags: {}
      }
    });
    const p = createQuestManagerSaveParticipant({
      getQuestManager: () => manager
    });
    expect(p.serialize().completedQuestIds).toEqual(["quest:x"]);
  });

  it("deserialize is a no-op when the getter yields null", () => {
    const p = createQuestManagerSaveParticipant({
      getQuestManager: () => null
    });
    // No throw, nothing to observe — just proves it doesn't try
    // to reach into a null manager.
    expect(() =>
      p.deserialize(
        { schemaVersion: 1, data: undefined as unknown } as SaveSlice<
          QuestManagerSlice
        >
      )
    ).not.toThrow();
  });

  it("deserialize forwards to the manager when available", () => {
    const manager = new QuestManager();
    const p = createQuestManagerSaveParticipant({
      getQuestManager: () => manager
    });
    p.deserialize({
      schemaVersion: 1,
      data: {
        activeQuests: {},
        completedQuestIds: ["quest:done"],
        trackedQuestDefinitionId: null,
        runtimeFlags: {}
      }
    });
    expect(manager.serializeSaveSlice().completedQuestIds).toEqual([
      "quest:done"
    ]);
  });
});
