import { describe, expect, it } from "vitest";
import {
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  type QuestStageDefinition
} from "@sugarmagic/domain";
import {
  applyNodeMoves,
  connectNodes,
  deleteNodes,
  disconnectEdges,
  failEdgeId,
  parseEdgeId,
  prerequisiteEdgeId,
  questStageToEditorEdges,
  questStageToEditorNodes
} from "@sugarmagic/workspaces";

function stageWith(): QuestStageDefinition {
  const first = createDefaultQuestNodeDefinition({
    nodeId: "node-a",
    displayName: "Talk to Guard",
    graphPosition: { x: 10, y: 20 }
  });
  const branch = createDefaultQuestNodeDefinition({
    nodeId: "node-b",
    displayName: "Has the key?",
    nodeBehavior: "branch",
    graphPosition: { x: 200, y: 20 }
  });
  const third = createDefaultQuestNodeDefinition({
    nodeId: "node-c",
    displayName: "Open the door",
    graphPosition: { x: 400, y: 20 }
  });
  return createDefaultQuestStageDefinition({
    stageId: "stage-1",
    nodeDefinitions: [
      first,
      { ...branch, prerequisiteNodeIds: ["node-a"] },
      { ...third, prerequisiteNodeIds: ["node-b"] }
    ],
    entryNodeIds: ["node-a"]
  });
}

describe("quest graph mapping", () => {
  it("maps every quest node to an editor node, keeping authored positions", () => {
    const nodes = questStageToEditorNodes(stageWith());
    expect(nodes.map((node) => node.id)).toEqual(["node-a", "node-b", "node-c"]);
    expect(nodes[0]!.position).toEqual({ x: 10, y: 20 });
    expect(nodes[0]!.payload).toMatchObject({ displayName: "Talk to Guard" });
  });

  it("gives branch nodes a pass and a fail port, and other nodes none", () => {
    const nodes = questStageToEditorNodes(stageWith());
    expect(nodes.find((node) => node.id === "node-b")?.outputs?.map((p) => p.name)).toEqual([
      "pass",
      "fail"
    ]);
    expect(nodes.find((node) => node.id === "node-a")?.outputs).toBeUndefined();
  });

  it("turns prerequisites into edges pointing at the node that requires them", () => {
    const edges = questStageToEditorEdges(stageWith());
    expect(edges).toContainEqual(
      expect.objectContaining({
        id: prerequisiteEdgeId("node-a", "node-b"),
        fromId: "node-a",
        toId: "node-b"
      })
    );
  });

  it("round-trips edge ids", () => {
    expect(parseEdgeId(prerequisiteEdgeId("x", "y"))).toEqual({
      relationship: "prerequisite",
      fromId: "x",
      toId: "y"
    });
    expect(parseEdgeId(failEdgeId("x", "y"))).toEqual({
      relationship: "fail",
      fromId: "x",
      toId: "y"
    });
    expect(parseEdgeId("nonsense")).toBeNull();
  });

  it("applies several node moves in one pass and leaves other nodes alone", () => {
    const moved = applyNodeMoves(stageWith(), [
      { id: "node-a", position: { x: -500, y: -300 } },
      { id: "node-c", position: { x: 900, y: 40 } }
    ]);
    expect(moved.nodeDefinitions[0]!.graphPosition).toEqual({ x: -500, y: -300 });
    expect(moved.nodeDefinitions[1]!.graphPosition).toEqual({ x: 200, y: 20 });
    expect(moved.nodeDefinitions[2]!.graphPosition).toEqual({ x: 900, y: 40 });
  });

  it("connecting adds a prerequisite to the target node", () => {
    const connected = connectNodes(stageWith(), { fromId: "node-a", toId: "node-c" });
    const target = connected.nodeDefinitions.find((node) => node.nodeId === "node-c");
    expect(target?.prerequisiteNodeIds).toEqual(["node-b", "node-a"]);
  });

  it("connecting from a fail port adds a fail target to the source node", () => {
    const connected = connectNodes(stageWith(), {
      fromId: "node-b",
      toId: "node-c",
      fromPort: "fail"
    });
    const source = connected.nodeDefinitions.find((node) => node.nodeId === "node-b");
    expect(source?.failTargetNodeIds).toEqual(["node-c"]);
  });

  it("ignores self-links, unknown nodes, and duplicate connections", () => {
    const stage = stageWith();
    expect(connectNodes(stage, { fromId: "node-a", toId: "node-a" })).toBe(stage);
    expect(connectNodes(stage, { fromId: "ghost", toId: "node-a" })).toBe(stage);
    const duplicate = connectNodes(stage, { fromId: "node-a", toId: "node-b" });
    expect(
      duplicate.nodeDefinitions.find((node) => node.nodeId === "node-b")
        ?.prerequisiteNodeIds
    ).toEqual(["node-a"]);
  });

  it("deleting a prerequisite edge removes exactly that link", () => {
    const disconnected = disconnectEdges(stageWith(), [
      prerequisiteEdgeId("node-a", "node-b")
    ]);
    expect(
      disconnected.nodeDefinitions.find((node) => node.nodeId === "node-b")
        ?.prerequisiteNodeIds
    ).toEqual([]);
    expect(
      disconnected.nodeDefinitions.find((node) => node.nodeId === "node-c")
        ?.prerequisiteNodeIds
    ).toEqual(["node-b"]);
  });

  it("deleting a fail edge removes it from the source node", () => {
    const withFail = connectNodes(stageWith(), {
      fromId: "node-b",
      toId: "node-c",
      fromPort: "fail"
    });
    const disconnected = disconnectEdges(withFail, [failEdgeId("node-b", "node-c")]);
    expect(
      disconnected.nodeDefinitions.find((node) => node.nodeId === "node-b")
        ?.failTargetNodeIds
    ).toEqual([]);
  });

  it("deleting a node scrubs it from prerequisites, fail targets, and entry nodes", () => {
    const withFail = connectNodes(stageWith(), {
      fromId: "node-b",
      toId: "node-c",
      fromPort: "fail"
    });
    const afterDelete = deleteNodes(withFail, ["node-b"]);
    expect(afterDelete.nodeDefinitions.map((node) => node.nodeId)).toEqual([
      "node-a",
      "node-c"
    ]);
    expect(
      afterDelete.nodeDefinitions.find((node) => node.nodeId === "node-c")
        ?.prerequisiteNodeIds
    ).toEqual([]);
    expect(afterDelete.entryNodeIds).toEqual(["node-a"]);
  });

  it("deleting an entry node removes it from entryNodeIds", () => {
    const afterDelete = deleteNodes(stageWith(), ["node-a"]);
    expect(afterDelete.entryNodeIds).toEqual([]);
  });

  it("allows a stage to be emptied completely", () => {
    const cleared = deleteNodes(stageWith(), ["node-a", "node-b", "node-c"]);
    expect(cleared.nodeDefinitions).toEqual([]);
    expect(cleared.entryNodeIds).toEqual([]);
  });
});
