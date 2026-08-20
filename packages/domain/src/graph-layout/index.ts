/**
 * packages/domain/src/graph-layout/index.ts
 *
 * Purpose: layout shapes shared by every authored graph -- quest stages,
 * dialogues, and shader graphs. Layout only: nothing here affects what a graph
 * means at runtime, just how it is arranged for reading.
 *
 * Status: active
 */

import { createUuid } from "../shared/identity";

export interface NodeGroupPosition {
  x: number;
  y: number;
}

export interface NodeGroupSize {
  width: number;
  height: number;
}

/**
 * A labelled box drawn around a set of nodes so a large graph reads as a few
 * named regions. Purely an authoring aid.
 *
 * Membership is held here and nowhere else. The editor needs each member to
 * point back at its group, but that direction is derived when the graph is
 * rendered rather than stored, so the two cannot disagree.
 *
 * `position` is absolute, in the same space as node positions. The editor works
 * in positions relative to the group, and converts on the way in and out.
 *
 * One shape for all three documents: a group carries its own position and size,
 * so it does not inherit the differences between the documents' own node
 * position types.
 */
export interface NodeGroup {
  groupId: string;
  label: string;
  memberNodeIds: string[];
  position: NodeGroupPosition;
  size: NodeGroupSize;
}

export const DEFAULT_NODE_GROUP_SIZE: NodeGroupSize = {
  width: 320,
  height: 220
};

export function createNodeGroupId(): string {
  return createUuid();
}

export function createNodeGroup(
  options: {
    groupId?: string;
    label?: string;
    memberNodeIds?: string[];
    position?: NodeGroupPosition;
    size?: NodeGroupSize;
  } = {}
): NodeGroup {
  return {
    groupId: options.groupId ?? createNodeGroupId(),
    label: options.label ?? "Group",
    memberNodeIds: [...(options.memberNodeIds ?? [])],
    position: { ...(options.position ?? { x: 0, y: 0 }) },
    size: { ...(options.size ?? DEFAULT_NODE_GROUP_SIZE) }
  };
}

/**
 * Keeps the groups a document declares, dropping any that are unusable and any
 * membership pointing at nodes that no longer exist -- a member id left behind
 * by a deleted node would make the editor look for something that is not there.
 *
 * `validNodeIds` omitted means membership is left alone, for callers that do not
 * have the node list to hand.
 */
export function normalizeNodeGroups(
  groups: readonly Partial<NodeGroup>[] | null | undefined,
  validNodeIds?: ReadonlySet<string>
): NodeGroup[] {
  if (!groups || groups.length === 0) return [];
  return groups
    .filter((group): group is Partial<NodeGroup> => Boolean(group?.groupId))
    .map((group) => ({
      groupId: group.groupId!,
      label: group.label ?? "Group",
      memberNodeIds: (group.memberNodeIds ?? []).filter(
        (nodeId) => !validNodeIds || validNodeIds.has(nodeId)
      ),
      position: {
        x: group.position?.x ?? 0,
        y: group.position?.y ?? 0
      },
      size: {
        width: group.size?.width ?? DEFAULT_NODE_GROUP_SIZE.width,
        height: group.size?.height ?? DEFAULT_NODE_GROUP_SIZE.height
      }
    }));
}
