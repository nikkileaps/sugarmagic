import { describe, expect, it } from "vitest";
import {
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createDefaultDialogueDefinition,
  normalizeDialogueDefinition,
  normalizeQuestStageDefinition
} from "@sugarmagic/domain";
import { QuestManager } from "@sugarmagic/runtime-core";

/**
 * Clearing a graph has to survive the load path. The normalizers used to
 * substitute a starter node for an empty one, so an emptied stage or dialogue
 * came back populated on the next open -- the deletion appeared to work and then
 * silently undid itself.
 */
describe("empty graphs survive normalization", () => {
  it("keeps an emptied quest stage empty", () => {
    const stage = normalizeQuestStageDefinition({
      stageId: "stage-1",
      displayName: "Cleared",
      nodeDefinitions: [],
      entryNodeIds: []
    });
    expect(stage.nodeDefinitions).toEqual([]);
    expect(stage.entryNodeIds).toEqual([]);
    expect(stage.stageId).toBe("stage-1");
  });

  it("leaves a populated quest stage alone", () => {
    const node = createDefaultQuestNodeDefinition({ nodeId: "n1" });
    const stage = normalizeQuestStageDefinition({
      stageId: "stage-1",
      displayName: "Start",
      nodeDefinitions: [node],
      entryNodeIds: ["n1"]
    });
    expect(stage.nodeDefinitions.map((candidate) => candidate.nodeId)).toEqual(["n1"]);
    expect(stage.entryNodeIds).toEqual(["n1"]);
  });

  it("keeps an emptied dialogue empty, with no node to start from", () => {
    const dialogue = normalizeDialogueDefinition({
      definitionId: "d1",
      displayName: "Cleared",
      startNodeId: "gone",
      nodes: [],
      interactionBinding: { npcDefinitionId: null }
    });
    expect(dialogue.nodes).toEqual([]);
    expect(dialogue.startNodeId).toBeNull();
  });

  it("leaves an existing dialogue's start node alone", () => {
    const existing = createDefaultDialogueDefinition({ definitionId: "d2" });
    const normalized = normalizeDialogueDefinition(existing);
    expect(normalized.startNodeId).toBe(existing.startNodeId);
    expect(normalized.nodes).toHaveLength(existing.nodes.length);
  });

  it("repoints a dialogue whose start node was deleted at the remaining first node", () => {
    const existing = createDefaultDialogueDefinition({ definitionId: "d3" });
    const normalized = normalizeDialogueDefinition({
      ...existing,
      startNodeId: "deleted-node"
    });
    expect(normalized.startNodeId).toBe(existing.nodes[0]!.nodeId);
  });

  it("creates a stage with no entry nodes when it is built with no nodes", () => {
    const stage = createDefaultQuestStageDefinition({ nodeDefinitions: [] });
    expect(stage.nodeDefinitions).toEqual([]);
    expect(stage.entryNodeIds).toEqual([]);
  });
});

describe("an empty quest stage at runtime", () => {
  it("completes immediately and moves the quest on rather than stalling", () => {
    const emptyStage = createDefaultQuestStageDefinition({
      stageId: "empty",
      nodeDefinitions: []
    });
    const finalStage = createDefaultQuestStageDefinition({
      stageId: "final",
      nodeDefinitions: [createDefaultQuestNodeDefinition({ nodeId: "n1" })]
    });

    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        definitionId: "q1",
        displayName: "Test quest",
        description: "",
        startStageId: "empty",
        stageDefinitions: [
          { ...emptyStage, nextStageId: "final" },
          finalStage
        ],
        rewardDefinitions: [],
        repeatable: false
      }
    ]);

    expect(manager.startQuest("q1")).toBe(true);
    // The empty stage has nothing to do, so the quest is already past it.
    expect(manager.getQuestStageState("q1", "empty")).toBe("completed");
    expect(manager.getTrackedQuest()?.stageId).toBe("final");
  });
});
