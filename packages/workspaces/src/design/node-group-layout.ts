/**
 * packages/workspaces/src/design/node-group-layout.ts
 *
 * Purpose: the arithmetic every graph editor needs to show NodeGroups. Written
 * once because it is the same in all three and easy to get subtly wrong: a
 * document stores absolute node positions, while the editor positions a member
 * relative to the frame it sits in.
 *
 * Status: active
 */

import type { NodeGroup } from "@sugarmagic/domain";
import type {
  GraphEditorGroup,
  GraphEditorNode,
  GraphEditorPosition
} from "@sugarmagic/ui/node-editor";

export function toEditorGroups(
  groups: readonly NodeGroup[] | undefined
): GraphEditorGroup[] {
  return (groups ?? []).map((group) => ({
    id: group.groupId,
    label: group.label,
    position: { ...group.position },
    size: { ...group.size }
  }));
}

/** Which group, if any, a node belongs to. */
export function groupOfNode(
  groups: readonly NodeGroup[] | undefined,
  nodeId: string
): NodeGroup | undefined {
  return (groups ?? []).find((group) => group.memberNodeIds.includes(nodeId));
}

/**
 * Turns an absolute node position into one relative to its group, and attaches
 * the group id, which is what the editor needs to draw the node inside its
 * frame. A node in no group is returned unchanged.
 */
export function placeNodeInGroup<TNode extends GraphEditorNode>(
  node: TNode,
  groups: readonly NodeGroup[] | undefined
): TNode {
  const group = groupOfNode(groups, node.id);
  if (!group) return node;
  return {
    ...node,
    parentId: group.groupId,
    position: {
      x: node.position.x - group.position.x,
      y: node.position.y - group.position.y
    }
  };
}

/**
 * The inverse: an editor position that may be relative back to an absolute one.
 * `parentId` comes from the editor's move report, so a node that moved outside
 * any frame passes straight through.
 */
export function toAbsolutePosition(
  position: GraphEditorPosition,
  parentId: string | undefined,
  groups: readonly NodeGroup[] | undefined
): GraphEditorPosition {
  if (!parentId) return { ...position };
  const group = (groups ?? []).find(
    (candidate) => candidate.groupId === parentId
  );
  if (!group) return { ...position };
  return {
    x: position.x + group.position.x,
    y: position.y + group.position.y
  };
}

/**
 * Moving a frame moves what is inside it. The editor reports only the frame's
 * own new position, because members keep their positions relative to it -- so
 * the members' absolute positions have to be shifted by the same delta here, or
 * they would spring back to where the frame used to be on the next load.
 */
export function shiftGroupMembers(
  group: NodeGroup,
  nextPosition: GraphEditorPosition
): { dx: number; dy: number } {
  return {
    dx: nextPosition.x - group.position.x,
    dy: nextPosition.y - group.position.y
  };
}

/** Is an absolute point inside a group's frame? */
function containsPoint(
  group: NodeGroup,
  position: GraphEditorPosition
): boolean {
  return (
    position.x >= group.position.x &&
    position.y >= group.position.y &&
    position.x <= group.position.x + group.size.width &&
    position.y <= group.position.y + group.size.height
  );
}

/**
 * Membership after a node is dropped: it belongs to the frame it was dropped
 * inside, and to no frame if it was dropped outside all of them. This is how a
 * node joins or leaves a group -- there is no separate command for it, because
 * dragging is how an author says where a node belongs.
 *
 * Frames are tested last-first so a frame drawn over another one wins, matching
 * what is on top on screen.
 *
 * Returns the same array when nothing changed, so a caller can skip the write.
 */
export function resolveMembership(
  groups: readonly NodeGroup[] | undefined,
  nodeId: string,
  absolutePosition: GraphEditorPosition
): NodeGroup[] {
  const current = groups ?? [];
  const target = [...current]
    .reverse()
    .find((group) => containsPoint(group, absolutePosition));
  const existing = groupOfNode(current, nodeId);
  if (existing?.groupId === target?.groupId) return [...current];

  return current.map((group) => {
    if (group.groupId === target?.groupId) {
      return group.memberNodeIds.includes(nodeId)
        ? group
        : { ...group, memberNodeIds: [...group.memberNodeIds, nodeId] };
    }
    if (group.memberNodeIds.includes(nodeId)) {
      return {
        ...group,
        memberNodeIds: group.memberNodeIds.filter(
          (memberId) => memberId !== nodeId
        )
      };
    }
    return group;
  });
}

/**
 * Adds a group, taking its members out of any group they were already in.
 *
 * A node in two groups has no sensible rendering -- it is drawn inside the first
 * and leaves the second as an empty frame around nothing -- so grouping a
 * selection moves those nodes rather than copying them.
 */
export function addGroup(
  groups: readonly NodeGroup[] | undefined,
  group: NodeGroup
): NodeGroup[] {
  const claimed = new Set(group.memberNodeIds);
  return [
    ...(groups ?? []).map((existing) => ({
      ...existing,
      memberNodeIds: existing.memberNodeIds.filter(
        (nodeId) => !claimed.has(nodeId)
      )
    })),
    group
  ];
}

/** Whether `resolveMembership` would change anything, for skipping a write. */
export function membershipChanged(
  before: readonly NodeGroup[] | undefined,
  after: readonly NodeGroup[]
): boolean {
  const previous = before ?? [];
  if (previous.length !== after.length) return true;
  return previous.some(
    (group, index) =>
      group.memberNodeIds.join(",") !== after[index]!.memberNodeIds.join(",")
  );
}

/**
 * A frame around a set of nodes, sized to hold them with room to breathe.
 * `nodeSize` is a rough allowance for the node bodies, which the editor measures
 * but the document does not know.
 */
export function frameAround(
  positions: readonly GraphEditorPosition[],
  nodeSize: { width: number; height: number } = { width: 260, height: 120 },
  padding = 40
): { position: GraphEditorPosition; size: { width: number; height: number } } {
  if (positions.length === 0) {
    return {
      position: { x: 0, y: 0 },
      size: { width: 320, height: 220 }
    };
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxX = Math.max(...positions.map((position) => position.x));
  const maxY = Math.max(...positions.map((position) => position.y));
  return {
    // The top edge gets extra room so the frame's label does not sit on top of
    // the first node.
    position: { x: minX - padding, y: minY - padding - 20 },
    size: {
      width: maxX - minX + nodeSize.width + padding * 2,
      height: maxY - minY + nodeSize.height + padding * 2 + 20
    }
  };
}
