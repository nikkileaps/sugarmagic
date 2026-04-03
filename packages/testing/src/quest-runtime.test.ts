import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId
} from "@sugarmagic/domain";
import { QuestManager } from "@sugarmagic/runtime-core";

describe("QuestManager", () => {
  it("routes NPC talk objectives through dialogue and completes them on dialogue end", () => {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Talk to Guard",
            description: "Speak with the station guard",
            objectiveSubtype: "talk"
          }),
          targetId: "npc:guard",
          dialogueDefinitionId: "dialogue:guard",
          completeOn: "dialogueEnd",
          showInHud: true
        }
      ]
    });
    const quest = createDefaultQuestDefinition({
      definitionId: "quest:station-guard",
      displayName: "Station Guard"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...quest,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);

    expect(manager.startQuest("quest:station-guard")).toBe(true);
    expect(manager.getDialogueOverrideForNpc("npc:guard")).toBe("dialogue:guard");

    manager.notifyDialogueFinished("dialogue:guard");

    expect(manager.isQuestCompleted("quest:station-guard")).toBe(true);
    expect(manager.getTrackedQuest()).toBeNull();
  });

  it("activates branch fail targets without unlocking the pass path", () => {
    const branchNodeId = createQuestNodeId();
    const passNodeId = createQuestNodeId();
    const failNodeId = createQuestNodeId();

    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: branchNodeId,
            displayName: "Check Gate",
            description: "See whether the gate is open",
            nodeBehavior: "branch"
          }),
          condition: { type: "hasFlag", key: "gate-open" },
          failTargetNodeIds: [failNodeId],
          showInHud: false
        },
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: passNodeId,
            displayName: "Walk Through Gate",
            description: "Use the open gate"
          }),
          prerequisiteNodeIds: [branchNodeId]
        },
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: failNodeId,
            displayName: "Find Another Way",
            description: "The gate is shut",
            objectiveSubtype: "custom"
          })
        }
      ],
      entryNodeIds: [branchNodeId]
    });

    const quest = createDefaultQuestDefinition({
      definitionId: "quest:branch-test",
      displayName: "Branch Test"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...quest,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);

    manager.startQuest("quest:branch-test");
    manager.update();

    const tracked = manager.getTrackedQuest();
    expect(tracked?.objectives.map((objective) => objective.displayName)).toEqual([
      "Find Another Way"
    ]);
  });

  it("completes cast spell objectives and evaluates spell conditions from providers", () => {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Cast Kindle",
            description: "Use Kindle on the dark room",
            objectiveSubtype: "castSpell"
          }),
          targetId: "spell:kindle"
        },
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Verify Spell Access",
            description: "Spell conditions should evaluate",
            nodeBehavior: "condition"
          }),
          condition: {
            type: "not",
            condition: {
              type: "canCastSpell",
              spellDefinitionId: "spell:blocked"
            }
          }
        }
      ]
    });

    const quest = createDefaultQuestDefinition({
      definitionId: "quest:spell-test",
      displayName: "Spell Test"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...quest,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);
    manager.setHasSpellProvider((spellDefinitionId) => spellDefinitionId === "spell:kindle");
    manager.setCanCastSpellProvider((spellDefinitionId) => spellDefinitionId === "spell:kindle");

    expect(manager.startQuest("quest:spell-test")).toBe(true);
    expect(manager.getTrackedQuest()?.objectives.map((objective) => objective.displayName)).toContain(
      "Cast Kindle"
    );

    manager.notifySpellCast("spell:kindle");

    expect(manager.isQuestCompleted("quest:spell-test")).toBe(true);
  });
});
