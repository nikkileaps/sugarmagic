import { describe, expect, it } from "vitest";
import type { DialogueDefinition } from "@sugarmagic/domain";
import { createNodeGroup } from "@sugarmagic/domain";
import {
  applyDialogueNodeMoves,
  canDeleteDialogueNodes,
  connectDialogueNodes,
  deleteDialogueNodes,
  dialogueEdgeId,
  dialogueToEditorEdges,
  dialogueToEditorNodes,
  disconnectDialogueEdges,
  parseDialogueEdgeId
} from "@sugarmagic/workspaces";
import { expectEdgePortsExist } from "./graph-edge-ports";

function dialogue(): DialogueDefinition {
  return {
    definitionId: "dlg-1",
    displayName: "Guard chat",
    startNodeId: "n1",
    interactionBinding: { npcDefinitionId: "npc:guard" },
    nodes: [
      {
        nodeId: "n1",
        text: "Halt.",
        next: [
          { targetNodeId: "n2", choiceText: "Who goes there?" },
          {
            targetNodeId: "n3",
            choiceText: "Let me pass",
            condition: { type: "flag", worldFlagId: "has-pass" }
          }
        ],
        graphPosition: { x: 10, y: 20 }
      },
      { nodeId: "n2", text: "State your business.", next: [], graphPosition: { x: 300, y: 0 } },
      { nodeId: "n3", text: "Go on through.", next: [], graphPosition: { x: 300, y: 120 } }
    ]
  };
}

describe("dialogue node deletion", () => {
  it("repoints the start when the start node is deleted", () => {
    const definition = dialogue();
    const start = definition.startNodeId!;
    const survivor = definition.nodes.find((node) => node.nodeId !== start)!;

    // Deleting the start while others remain is refused, so clear the rest
    // first -- which is exactly what the refusal message tells the author.
    const others = definition.nodes
      .filter((node) => node.nodeId !== start)
      .map((node) => node.nodeId);
    const cleared = deleteDialogueNodes(definition, others);
    expect(cleared.startNodeId).toBe(start);

    const emptied = deleteDialogueNodes(cleared, [start]);
    expect(emptied.nodes).toEqual([]);
    expect(emptied.startNodeId).toBeNull();

    // And when a non-start node goes, the start is untouched.
    const withoutSurvivor = deleteDialogueNodes(definition, [survivor.nodeId]);
    expect(withoutSurvivor.startNodeId).toBe(start);
  });

  it("drops deleted nodes from any group they were in", () => {
    const definition = dialogue();
    const doomed = definition.nodes.find(
      (node) => node.nodeId !== definition.startNodeId
    )!;
    const grouped = {
      ...definition,
      groups: [
        createNodeGroup({
          groupId: "g1",
          label: "Opening",
          memberNodeIds: definition.nodes.map((node) => node.nodeId)
        })
      ]
    };

    const after = deleteDialogueNodes(grouped, [doomed.nodeId]);
    expect(after.groups?.[0]!.memberNodeIds).not.toContain(doomed.nodeId);
  });
});

describe("dialogue graph mapping", () => {
  it("only emits edges whose ports exist on the nodes they attach to", () => {
    const definition = dialogue();
    expectEdgePortsExist(
      dialogueToEditorNodes(definition, null),
      dialogueToEditorEdges(definition)
    );
  });

  it("maps nodes and marks the start node", () => {
    const nodes = dialogueToEditorNodes(dialogue(), null);
    expect(nodes.map((node) => node.id)).toEqual(["n1", "n2", "n3"]);
    expect(nodes[0]!.payload).toMatchObject({ isStart: true, isPlaytestActive: false });
    expect(nodes[1]!.payload).toMatchObject({ isStart: false });
  });

  it("marks the playtest node without touching the others", () => {
    const nodes = dialogueToEditorNodes(dialogue(), "n2");
    expect(nodes[1]!.payload).toMatchObject({ isPlaytestActive: true });
    expect(nodes[0]!.payload).toMatchObject({ isPlaytestActive: false });
  });

  it("gives a node one port per choice, and none when there is a single continuation", () => {
    const nodes = dialogueToEditorNodes(dialogue(), null);
    expect(nodes[0]!.outputs?.map((port) => port.name)).toEqual(["choice-0", "choice-1"]);
    expect(nodes[1]!.outputs).toBeUndefined();
  });

  it("draws a conditional connection dashed", () => {
    const edges = dialogueToEditorEdges(dialogue());
    const conditional = edges.find((edge) => edge.toId === "n3");
    expect(conditional?.dashed).toBe(true);
    const plain = edges.find((edge) => edge.toId === "n2");
    expect(plain?.dashed).toBe(false);
  });

  it("round-trips connection ids, which carry the position in the list", () => {
    expect(parseDialogueEdgeId(dialogueEdgeId("n1", 1))).toEqual({
      fromNodeId: "n1",
      index: 1
    });
    expect(parseDialogueEdgeId("nonsense")).toBeNull();
  });

  it("moves several nodes in one pass", () => {
    const moved = applyDialogueNodeMoves(dialogue(), [
      { id: "n1", position: { x: -400, y: -200 } }
    ]);
    expect(moved.nodes[0]!.graphPosition).toEqual({ x: -400, y: -200 });
    expect(moved.nodes[1]!.graphPosition).toEqual({ x: 300, y: 0 });
  });

  it("connecting from a choice port adds choice text; a plain connection does not", () => {
    const fromChoice = connectDialogueNodes(dialogue(), {
      fromId: "n2",
      toId: "n3",
      fromPort: "choice-0"
    });
    expect(fromChoice.nodes[1]!.next[0]).toMatchObject({
      targetNodeId: "n3",
      choiceText: "Choice 1"
    });

    const plain = connectDialogueNodes(dialogue(), { fromId: "n2", toId: "n3" });
    expect(plain.nodes[1]!.next[0]).toEqual({ targetNodeId: "n3" });
  });

  it("ignores duplicate and unknown connections", () => {
    const base = dialogue();
    expect(connectDialogueNodes(base, { fromId: "n1", toId: "n2" })).toBe(base);
    expect(connectDialogueNodes(base, { fromId: "ghost", toId: "n2" })).toBe(base);
    expect(connectDialogueNodes(base, { fromId: "n1", toId: "ghost" })).toBe(base);
  });

  it("removes a connection by position, keeping the others in order", () => {
    const after = disconnectDialogueEdges(dialogue(), [dialogueEdgeId("n1", 0)]);
    expect(after.nodes[0]!.next).toHaveLength(1);
    expect(after.nodes[0]!.next[0]).toMatchObject({ targetNodeId: "n3" });
  });

  it("removes several connections from one node without index drift", () => {
    const after = disconnectDialogueEdges(dialogue(), [
      dialogueEdgeId("n1", 0),
      dialogueEdgeId("n1", 1)
    ]);
    expect(after.nodes[0]!.next).toEqual([]);
  });

  it("deleting a node also removes connections pointing at it", () => {
    const after = deleteDialogueNodes(dialogue(), ["n2"]);
    expect(after.nodes.map((node) => node.nodeId)).toEqual(["n1", "n3"]);
    expect(after.nodes[0]!.next.map((edge) => edge.targetNodeId)).toEqual(["n3"]);
  });

  it("refuses to delete the start node while other nodes remain, and says why", () => {
    const refusal = canDeleteDialogueNodes(dialogue(), ["n1"]);
    expect(refusal.allowed).toBe(false);
    expect(refusal.reason).toMatch(/start node/i);
  });

  it("allows the last remaining node to be deleted, clearing the dialogue", () => {
    const single: DialogueDefinition = {
      ...dialogue(),
      startNodeId: "only",
      nodes: [{ nodeId: "only", text: "Hi.", next: [], graphPosition: { x: 0, y: 0 } }]
    };
    expect(canDeleteDialogueNodes(single, ["only"]).allowed).toBe(true);
    expect(deleteDialogueNodes(single, ["only"]).nodes).toEqual([]);
  });

  it("allows clearing every node at once", () => {
    const all = dialogue().nodes.map((node) => node.nodeId);
    expect(canDeleteDialogueNodes(dialogue(), all).allowed).toBe(true);
  });

  it("allows deleting an ordinary node", () => {
    expect(canDeleteDialogueNodes(dialogue(), ["n2"])).toEqual({ allowed: true });
  });
});
