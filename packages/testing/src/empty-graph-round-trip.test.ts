import { describe, expect, it } from "vitest";
import {
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createDefaultDialogueDefinition,
  normalizeDialogueDefinition,
  normalizeQuestStageDefinition,
  createNodeGroup,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultShaderGraphDocument,
  createEmptyContentLibrarySnapshot,
  getAllShaderDefinitions,
  normalizeContentLibrarySnapshot,
  applyCommand
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
    expect(stage.nodeDefinitions.map((candidate) => candidate.nodeId)).toEqual([
      "n1"
    ]);
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
        stageDefinitions: [{ ...emptyStage, nextStageId: "final" }, finalStage],
        rewardDefinitions: [],
        repeatable: false
      }
    ]);

    expect(manager.startQuest("q1")).toBe(true);
    // The empty stage has nothing to do, so the quest is already past it.
    expect(manager.getQuestStageState("q1", "empty")).toBe("completed");
    expect(manager.getTrackedQuest()?.stageId).toBe("final");
  });

  // An empty stage completes the moment it starts, so two of them naming each
  // other as the next stage would advance back and forth forever.
  it("parks a quest whose empty stages point at each other instead of hanging", () => {
    const first = createDefaultQuestStageDefinition({
      stageId: "a",
      nodeDefinitions: []
    });
    const second = createDefaultQuestStageDefinition({
      stageId: "b",
      nodeDefinitions: []
    });

    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        definitionId: "q-loop",
        displayName: "Looping quest",
        description: "",
        startStageId: "a",
        stageDefinitions: [
          { ...first, nextStageId: "b" },
          { ...second, nextStageId: "a" }
        ],
        rewardDefinitions: [],
        repeatable: false
      }
    ]);

    expect(() => manager.startQuest("q-loop")).not.toThrow();
  });
});

/**
 * Groups are layout, but they still have to survive the load path -- a `groups`
 * field the normalizer does not carry is silently dropped on reload, which is
 * the same trap that made an emptied graph refill itself.
 */
describe("node groups survive normalization", () => {
  it("keeps a quest stage's groups, and drops membership for deleted nodes", () => {
    const node = createDefaultQuestNodeDefinition({ nodeId: "kept" });
    const stage = normalizeQuestStageDefinition({
      stageId: "s1",
      displayName: "Start",
      nodeDefinitions: [node],
      entryNodeIds: ["kept"],
      groups: [
        createNodeGroup({
          groupId: "g1",
          label: "Opening beat",
          memberNodeIds: ["kept", "deleted-node"],
          position: { x: 40, y: 60 },
          size: { width: 400, height: 300 }
        })
      ]
    });
    expect(stage.groups).toHaveLength(1);
    expect(stage.groups![0]).toMatchObject({
      groupId: "g1",
      label: "Opening beat",
      position: { x: 40, y: 60 },
      size: { width: 400, height: 300 }
    });
    expect(stage.groups![0]!.memberNodeIds).toEqual(["kept"]);
  });

  it("gives a stage with no groups an empty list rather than nothing", () => {
    const stage = normalizeQuestStageDefinition({
      stageId: "s2",
      displayName: "Start",
      nodeDefinitions: [],
      entryNodeIds: []
    });
    expect(stage.groups).toEqual([]);
  });

  it("keeps a dialogue's groups", () => {
    const existing = createDefaultDialogueDefinition({ definitionId: "d1" });
    const normalized = normalizeDialogueDefinition({
      ...existing,
      groups: [
        createNodeGroup({
          groupId: "g2",
          label: "Greeting",
          memberNodeIds: [existing.nodes[0]!.nodeId]
        })
      ]
    });
    expect(normalized.groups).toHaveLength(1);
    expect(normalized.groups![0]!.label).toBe("Greeting");
    expect(normalized.groups![0]!.memberNodeIds).toEqual([
      existing.nodes[0]!.nodeId
    ]);
  });

  it("keeps a shader graph's groups through the content library", () => {
    const snapshot = createEmptyContentLibrarySnapshot("little-world");
    const shader = createDefaultShaderGraphDocument("little-world", {
      shaderDefinitionId: "little-world:shader:test"
    });
    const normalized = normalizeContentLibrarySnapshot(
      {
        ...snapshot,
        shaderDefinitions: [
          {
            ...shader,
            groups: [
              createNodeGroup({
                groupId: "g3",
                label: "Colour mixing",
                memberNodeIds: [shader.nodes[0]!.nodeId, "deleted-node"]
              })
            ]
          }
        ]
      },
      "little-world"
    );

    const stored = normalized.shaderDefinitions.find(
      (definition) =>
        definition.shaderDefinitionId === "little-world:shader:test"
    );
    expect(stored?.groups).toHaveLength(1);
    expect(stored?.groups![0]!.label).toBe("Colour mixing");
    expect(stored?.groups![0]!.memberNodeIds).toEqual([
      shader.nodes[0]!.nodeId
    ]);
  });
});

/**
 * Groups on a shader graph are written through a command, so the command has to
 * land on the document the editor reads back.
 */
describe("SetShaderGraphNodeGroups", () => {
  it("replaces the groups on the addressed shader graph", () => {
    const project = createDefaultGameProject("Little World", "little-world");
    const session = createAuthoringSession(project, []);
    const shader = getAllShaderDefinitions(session)[0]!;

    const group = createNodeGroup({
      groupId: "g4",
      label: "Inputs",
      memberNodeIds: [shader.nodes[0]!.nodeId]
    });
    const next = applyCommand(session, {
      kind: "SetShaderGraphNodeGroups",
      target: {
        aggregateKind: "content-definition",
        aggregateId: shader.shaderDefinitionId
      },
      subject: {
        subjectKind: "shader-definition",
        subjectId: shader.shaderDefinitionId
      },
      payload: {
        shaderDefinitionId: shader.shaderDefinitionId,
        groups: [group]
      }
    });

    const updated = getAllShaderDefinitions(next).find(
      (definition) =>
        definition.shaderDefinitionId === shader.shaderDefinitionId
    );
    expect(updated?.groups).toEqual([group]);
  });
});

/**
 * Removing a shader node is one command, and it owns every consequence: the
 * edges that touched the node, and its place in any group. The editor used to
 * remove the edges itself first, which cost one undo step per edge.
 */
describe("RemoveShaderNode", () => {
  it("drops the node's edges and its group membership in one step", () => {
    const project = createDefaultGameProject("Little World", "little-world");
    const session = createAuthoringSession(project, []);
    const shader = getAllShaderDefinitions(session)[0]!;
    const doomed = shader.nodes[0]!;

    const withGroup = applyCommand(session, {
      kind: "SetShaderGraphNodeGroups",
      target: {
        aggregateKind: "content-definition",
        aggregateId: shader.shaderDefinitionId
      },
      subject: {
        subjectKind: "shader-definition",
        subjectId: shader.shaderDefinitionId
      },
      payload: {
        shaderDefinitionId: shader.shaderDefinitionId,
        groups: [
          createNodeGroup({
            groupId: "g5",
            label: "Doomed",
            memberNodeIds: shader.nodes.map((node) => node.nodeId)
          })
        ]
      }
    });

    const after = applyCommand(withGroup, {
      kind: "RemoveShaderNode",
      target: {
        aggregateKind: "content-definition",
        aggregateId: shader.shaderDefinitionId
      },
      subject: {
        subjectKind: "shader-definition",
        subjectId: shader.shaderDefinitionId
      },
      payload: {
        shaderDefinitionId: shader.shaderDefinitionId,
        nodeId: doomed.nodeId
      }
    });

    const updated = getAllShaderDefinitions(after).find(
      (definition) =>
        definition.shaderDefinitionId === shader.shaderDefinitionId
    )!;
    expect(updated.nodes.some((node) => node.nodeId === doomed.nodeId)).toBe(
      false
    );
    expect(
      updated.edges.some(
        (edge) =>
          edge.sourceNodeId === doomed.nodeId ||
          edge.targetNodeId === doomed.nodeId
      )
    ).toBe(false);
    expect(updated.groups?.[0]!.memberNodeIds).not.toContain(doomed.nodeId);
  });
});
