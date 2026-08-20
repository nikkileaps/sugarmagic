/**
 * Quest actions carry the node that fired them.
 *
 * Handlers need the source to name what they act on -- the playCue action
 * builds its audio instance key from it, so two nodes playing the same cue are
 * separate instances. The ids are passed down from the node, not read back off
 * the manager, which only exposes the tracked quest.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId,
  type QuestActionDefinition
} from "@sugarmagic/domain";
import { QuestManager, type QuestActionInvocation } from "@sugarmagic/runtime-core";

function questWithNodeActions(options: {
  questDefinitionId: string;
  nodeId: string;
  onEnterActions?: QuestActionDefinition[];
  onCompleteActions?: QuestActionDefinition[];
  eventName?: string;
}) {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          nodeId: options.nodeId,
          displayName: "Ring the Bell",
          description: "Ring it",
          objectiveSubtype: "custom"
        }),
        eventName: options.eventName,
        onEnterActions: options.onEnterActions ?? [],
        onCompleteActions: options.onCompleteActions ?? []
      }
    ]
  });
  const quest = createDefaultQuestDefinition({
    definitionId: options.questDefinitionId,
    displayName: "Bell Quest"
  });
  return {
    ...quest,
    startStageId: stage.stageId,
    stageDefinitions: [stage],
    stageId: stage.stageId
  };
}

describe("quest action invocation", () => {
  it("names the quest, stage and node that fired an on-enter action", () => {
    const nodeId = createQuestNodeId();
    const definition = questWithNodeActions({
      questDefinitionId: "quest:bell",
      nodeId,
      onEnterActions: [{ type: "playCue", cueDefinitionId: "cue:bell" }]
    });

    const invocations: QuestActionInvocation[] = [];
    const manager = new QuestManager();
    manager.registerDefinitions([definition]);
    manager.setActionHandler((invocation) => invocations.push(invocation));

    expect(manager.startQuest("quest:bell")).toBe(true);

    expect(invocations).toEqual([
      {
        action: { type: "playCue", cueDefinitionId: "cue:bell" },
        questDefinitionId: "quest:bell",
        stageId: definition.stageId,
        nodeId
      }
    ]);
  });

  it("names the completing node for an on-complete action", () => {
    const nodeId = createQuestNodeId();
    const definition = questWithNodeActions({
      questDefinitionId: "quest:bell",
      nodeId,
      eventName: "bell-rung",
      onCompleteActions: [{ type: "playCue", cueDefinitionId: "cue:bell" }]
    });

    const invocations: QuestActionInvocation[] = [];
    const manager = new QuestManager();
    manager.registerDefinitions([definition]);
    manager.setActionHandler((invocation) => invocations.push(invocation));
    manager.startQuest("quest:bell");
    manager.notifyEvent("bell-rung");

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.nodeId).toBe(nodeId);
    expect(invocations[0]?.stageId).toBe(definition.stageId);
  });

  it("keeps each node's source straight when one action completes another node", () => {
    // executeActions is reentrant: the emitEvent action completes a second
    // node, whose own actions run before the first loop finishes. Held as
    // ambient state this would report the wrong node.
    const firstNodeId = createQuestNodeId();
    const secondNodeId = createQuestNodeId();
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: secondNodeId,
            displayName: "Answer the Bell",
            description: "Answer it",
            objectiveSubtype: "custom"
          }),
          eventName: "bell-rung",
          onCompleteActions: [{ type: "playCue", cueDefinitionId: "cue:answer" }]
        },
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: firstNodeId,
            displayName: "Ring the Bell",
            description: "Ring it",
            objectiveSubtype: "custom"
          }),
          eventName: "ring",
          onCompleteActions: [
            { type: "emitEvent", eventName: "bell-rung" },
            { type: "playCue", cueDefinitionId: "cue:ring" }
          ]
        }
      ]
    });
    const quest = createDefaultQuestDefinition({
      definitionId: "quest:bell",
      displayName: "Bell Quest"
    });

    const invocations: QuestActionInvocation[] = [];
    const manager = new QuestManager();
    manager.registerDefinitions([
      { ...quest, startStageId: stage.stageId, stageDefinitions: [stage] }
    ]);
    manager.setActionHandler((invocation) => invocations.push(invocation));
    manager.startQuest("quest:bell");
    manager.notifyEvent("ring");

    // The inner node's action runs first, then the outer node's remaining
    // action -- each reporting its own node.
    expect(
      invocations.map((invocation) => [
        invocation.action.type === "playCue"
          ? invocation.action.cueDefinitionId
          : null,
        invocation.nodeId
      ])
    ).toEqual([
      ["cue:answer", secondNodeId],
      ["cue:ring", firstNodeId]
    ]);
  });
});
