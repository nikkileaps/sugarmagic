import { describe, expect, it } from "vitest";
import { createNodeGroup } from "@sugarmagic/domain";
import {
  addGroup,
  frameAround,
  groupOfNode,
  placeNodeInGroup,
  shiftGroupMembers,
  toAbsolutePosition,
  toEditorGroups,
  resolveMembership,
  membershipChanged
} from "@sugarmagic/workspaces";
import { splitDeletedNodes } from "@sugarmagic/ui/node-editor";
import type { GraphEditorNode } from "@sugarmagic/ui/node-editor";

const groups = [
  createNodeGroup({
    groupId: "g1",
    label: "Opening",
    memberNodeIds: ["a", "b"],
    position: { x: 100, y: 200 },
    size: { width: 400, height: 300 }
  })
];

function node(id: string, x: number, y: number): GraphEditorNode {
  return { id, kind: "test", position: { x, y }, payload: null };
}

describe("node group layout", () => {
  it("maps a group to the editor's shape", () => {
    const [editorGroup] = toEditorGroups(groups);
    expect(editorGroup).toEqual({
      id: "g1",
      label: "Opening",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 }
    });
  });

  it("finds which group a node belongs to, and reports none for an outsider", () => {
    expect(groupOfNode(groups, "a")?.groupId).toBe("g1");
    expect(groupOfNode(groups, "z")).toBeUndefined();
    expect(groupOfNode(undefined, "a")).toBeUndefined();
  });

  it("makes a member's position relative to its group", () => {
    const placed = placeNodeInGroup(node("a", 160, 260), groups);
    expect(placed.parentId).toBe("g1");
    expect(placed.position).toEqual({ x: 60, y: 60 });
  });

  it("leaves a node outside any group alone", () => {
    const placed = placeNodeInGroup(node("z", 10, 20), groups);
    expect(placed.parentId).toBeUndefined();
    expect(placed.position).toEqual({ x: 10, y: 20 });
  });

  it("converts a relative position back to absolute", () => {
    expect(toAbsolutePosition({ x: 60, y: 60 }, "g1", groups)).toEqual({
      x: 160,
      y: 260
    });
  });

  it("round-trips a position through both conversions unchanged", () => {
    const original = node("a", 173, 291);
    const placed = placeNodeInGroup(original, groups);
    const back = toAbsolutePosition(placed.position, placed.parentId, groups);
    expect(back).toEqual(original.position);
  });

  it("passes a position through untouched when there is no group to convert against", () => {
    expect(toAbsolutePosition({ x: 5, y: 6 }, undefined, groups)).toEqual({
      x: 5,
      y: 6
    });
    expect(toAbsolutePosition({ x: 5, y: 6 }, "missing", groups)).toEqual({
      x: 5,
      y: 6
    });
  });

  it("reports how far a group moved so members can be shifted with it", () => {
    expect(shiftGroupMembers(groups[0]!, { x: 140, y: 180 })).toEqual({
      dx: 40,
      dy: -20
    });
  });

  it("sizes a frame to hold the nodes it is drawn around", () => {
    const frame = frameAround([
      { x: 100, y: 100 },
      { x: 400, y: 300 }
    ]);
    expect(frame.position.x).toBeLessThan(100);
    expect(frame.position.y).toBeLessThan(100);
    expect(frame.size.width).toBeGreaterThan(400 - 100);
    expect(frame.size.height).toBeGreaterThan(300 - 100);
  });

  it("gives a default frame when there is nothing to enclose", () => {
    expect(frameAround([])).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 320, height: 220 }
    });
  });
});

/**
 * React Flow deletes a parent's children along with it, so a frame deletion
 * arrives at the editor as the frame plus every node inside it. Deleting a frame
 * has to leave the nodes alone.
 */
describe("splitDeletedNodes", () => {
  it("drops member nodes when their frame is being deleted", () => {
    const split = splitDeletedNodes([
      { id: "g1", type: "sugarGroup" },
      { id: "n1", type: "sugarNode", parentId: "g1" }
    ]);
    expect(split.groupIds).toEqual(["g1"]);
    expect(split.nodeIds).toEqual([]);
  });

  it("keeps a node deleted on its own, even one inside a frame", () => {
    const split = splitDeletedNodes([
      { id: "n1", type: "sugarNode", parentId: "g1" }
    ]);
    expect(split.groupIds).toEqual([]);
    expect(split.nodeIds).toEqual(["n1"]);
  });

  // A rubber band over a frame's members picks up the frame too. The members
  // were chosen deliberately, so they go; without this they were silently kept
  // and only the frame was removed.
  it("keeps member nodes that were selected in their own right", () => {
    const split = splitDeletedNodes([
      { id: "g1", type: "sugarGroup", selected: true },
      { id: "n1", type: "sugarNode", parentId: "g1", selected: true },
      { id: "n2", type: "sugarNode", parentId: "g1" }
    ]);
    expect(split.groupIds).toEqual(["g1"]);
    expect(split.nodeIds).toEqual(["n1"]);
  });
});

describe("addGroup", () => {
  it("moves nodes out of the group they were in", () => {
    const first = createNodeGroup({
      groupId: "g1",
      label: "First",
      memberNodeIds: ["a", "b", "c"]
    });
    const second = createNodeGroup({
      groupId: "g2",
      label: "Second",
      memberNodeIds: ["b", "c"]
    });

    const groups = addGroup([first], second);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.memberNodeIds).toEqual(["a"]);
    expect(groups[1]!.memberNodeIds).toEqual(["b", "c"]);
  });
});

/**
 * Joining and leaving a group is a drag, so membership is decided by where the
 * node was dropped. React Flow does not do this -- it only reports the move.
 */
describe("resolveMembership", () => {
  const group = createNodeGroup({
    groupId: "g1",
    label: "Opening",
    memberNodeIds: ["inside"],
    position: { x: 100, y: 100 },
    size: { width: 400, height: 300 }
  });

  it("adds a node dropped inside a frame", () => {
    const next = resolveMembership([group], "joiner", { x: 200, y: 200 });
    expect(next[0]!.memberNodeIds).toEqual(["inside", "joiner"]);
  });

  it("removes a node dropped outside every frame", () => {
    const next = resolveMembership([group], "inside", { x: 900, y: 900 });
    expect(next[0]!.memberNodeIds).toEqual([]);
  });

  it("leaves membership alone when a node is dragged within its own frame", () => {
    const next = resolveMembership([group], "inside", { x: 150, y: 150 });
    expect(membershipChanged([group], next)).toBe(false);
  });

  it("does not list a node twice in the group it is already in", () => {
    const overlapping = createNodeGroup({
      groupId: "g2",
      label: "Later",
      memberNodeIds: ["inside"],
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 }
    });
    const next = resolveMembership([overlapping], "inside", { x: 200, y: 200 });
    expect(next[0]!.memberNodeIds).toEqual(["inside"]);
  });

  it("moves a node between overlapping frames, the topmost frame winning", () => {
    const other = createNodeGroup({
      groupId: "g2",
      label: "Later",
      memberNodeIds: [],
      position: { x: 150, y: 150 },
      size: { width: 400, height: 300 }
    });
    const next = resolveMembership([group, other], "inside", {
      x: 200,
      y: 200
    });
    expect(next[0]!.memberNodeIds).toEqual([]);
    expect(next[1]!.memberNodeIds).toEqual(["inside"]);
  });
});
