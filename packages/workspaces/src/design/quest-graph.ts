/**
 * packages/workspaces/src/design/quest-graph.ts
 *
 * Purpose: translates a quest stage into the shared node editor's nodes and edges,
 * and turns editor gestures back into new stage data. Pure functions, so the
 * translation can be unit tested without a browser.
 *
 * Status: active
 */

import { normalizeNodeGroups } from "@sugarmagic/domain";
import type {
  QuestNodeDefinition,
  QuestStageDefinition
} from "@sugarmagic/domain";
import type {
  GraphEditorEdge,
  GraphEditorNode,
  GraphEditorNodeMove
} from "@sugarmagic/ui/node-editor";

export const QUEST_NODE_KIND = "quest-node";

const BRANCH_PASS_PORT = "pass";
const BRANCH_FAIL_PORT = "fail";

/**
 * Edge ids carry which relationship they stand for, because the two are stored on
 * opposite ends: a prerequisite lives on the target node, a fail target lives on
 * the source node. Deleting an edge has to know which list to edit.
 */
export function prerequisiteEdgeId(fromId: string, toId: string): string {
  return `prereq:${fromId}->${toId}`;
}

export function failEdgeId(fromId: string, toId: string): string {
  return `fail:${fromId}->${toId}`;
}

interface ParsedEdgeId {
  relationship: "prerequisite" | "fail";
  fromId: string;
  toId: string;
}

export function parseEdgeId(edgeId: string): ParsedEdgeId | null {
  const separator = edgeId.indexOf(":");
  if (separator < 0) return null;
  const prefix = edgeId.slice(0, separator);
  const [fromId, toId] = edgeId.slice(separator + 1).split("->");
  if (!fromId || !toId) return null;
  if (prefix === "prereq")
    return { relationship: "prerequisite", fromId, toId };
  if (prefix === "fail") return { relationship: "fail", fromId, toId };
  return null;
}

export function questStageToEditorNodes(
  stage: QuestStageDefinition
): GraphEditorNode[] {
  return stage.nodeDefinitions.map((node) => ({
    id: node.nodeId,
    kind: QUEST_NODE_KIND,
    position: { ...node.graphPosition },
    payload: node,
    outputs:
      node.nodeBehavior === "branch"
        ? [
            {
              name: BRANCH_PASS_PORT,
              color: "var(--sm-accent-blue)",
              yPercent: 0.35
            },
            {
              name: BRANCH_FAIL_PORT,
              color: "var(--sm-accent-red)",
              yPercent: 0.65
            }
          ]
        : undefined
  }));
}

export function questStageToEditorEdges(
  stage: QuestStageDefinition
): GraphEditorEdge[] {
  const behaviorByNodeId = new Map(
    stage.nodeDefinitions.map((node) => [node.nodeId, node.nodeBehavior])
  );
  const edges: GraphEditorEdge[] = [];
  for (const node of stage.nodeDefinitions) {
    for (const prerequisiteNodeId of node.prerequisiteNodeIds) {
      edges.push({
        id: prerequisiteEdgeId(prerequisiteNodeId, node.nodeId),
        fromId: prerequisiteNodeId,
        toId: node.nodeId,
        // A branch node's two outputs are named; every other node has a single
        // output the editor calls "out". An edge has to name a port the source
        // node actually has, or it is not drawn at all.
        ...(behaviorByNodeId.get(prerequisiteNodeId) === "branch"
          ? { fromPort: BRANCH_PASS_PORT }
          : {}),
        color: "var(--sm-accent-blue)"
      });
    }
    for (const failTargetNodeId of node.failTargetNodeIds) {
      edges.push({
        id: failEdgeId(node.nodeId, failTargetNodeId),
        fromId: node.nodeId,
        toId: failTargetNodeId,
        fromPort: BRANCH_FAIL_PORT,
        color: "var(--sm-accent-red)",
        dashed: true
      });
    }
  }
  return edges;
}

export function applyNodeMoves(
  stage: QuestStageDefinition,
  moves: GraphEditorNodeMove[]
): QuestStageDefinition {
  if (moves.length === 0) return stage;
  const byId = new Map(moves.map((move) => [move.id, move.position]));
  return {
    ...stage,
    nodeDefinitions: stage.nodeDefinitions.map((node) => {
      const position = byId.get(node.nodeId);
      return position ? { ...node, graphPosition: { ...position } } : node;
    })
  };
}

/**
 * A connection from a branch node's fail port becomes a fail target on the source
 * node. Everything else becomes a prerequisite on the target node. Self-links and
 * duplicates are ignored.
 */
export function connectNodes(
  stage: QuestStageDefinition,
  connection: { fromId: string; toId: string; fromPort?: string }
): QuestStageDefinition {
  const { fromId, toId, fromPort } = connection;
  if (fromId === toId) return stage;
  if (!stage.nodeDefinitions.some((node) => node.nodeId === fromId))
    return stage;
  if (!stage.nodeDefinitions.some((node) => node.nodeId === toId)) return stage;

  if (fromPort === BRANCH_FAIL_PORT) {
    return {
      ...stage,
      nodeDefinitions: stage.nodeDefinitions.map((node) =>
        node.nodeId === fromId && !node.failTargetNodeIds.includes(toId)
          ? { ...node, failTargetNodeIds: [...node.failTargetNodeIds, toId] }
          : node
      )
    };
  }

  return {
    ...stage,
    nodeDefinitions: stage.nodeDefinitions.map((node) =>
      node.nodeId === toId && !node.prerequisiteNodeIds.includes(fromId)
        ? {
            ...node,
            prerequisiteNodeIds: [...node.prerequisiteNodeIds, fromId]
          }
        : node
    )
  };
}

export function disconnectEdges(
  stage: QuestStageDefinition,
  edgeIds: string[]
): QuestStageDefinition {
  const parsed = edgeIds
    .map((edgeId) => parseEdgeId(edgeId))
    .filter((edge): edge is ParsedEdgeId => edge !== null);
  if (parsed.length === 0) return stage;

  return {
    ...stage,
    nodeDefinitions: stage.nodeDefinitions.map((node) => {
      const droppedPrerequisites = parsed
        .filter(
          (edge) =>
            edge.relationship === "prerequisite" && edge.toId === node.nodeId
        )
        .map((edge) => edge.fromId);
      const droppedFailTargets = parsed
        .filter(
          (edge) => edge.relationship === "fail" && edge.fromId === node.nodeId
        )
        .map((edge) => edge.toId);
      if (
        droppedPrerequisites.length === 0 &&
        droppedFailTargets.length === 0
      ) {
        return node;
      }
      return {
        ...node,
        prerequisiteNodeIds: node.prerequisiteNodeIds.filter(
          (nodeId) => !droppedPrerequisites.includes(nodeId)
        ),
        failTargetNodeIds: node.failTargetNodeIds.filter(
          (nodeId) => !droppedFailTargets.includes(nodeId)
        )
      };
    })
  };
}

/**
 * Removes nodes and every reference to them: other nodes' prerequisite and fail
 * lists, and the stage's entry nodes. Leaving a dangling id would strand the
 * stage, since a node whose prerequisite no longer exists can never activate.
 */
export function deleteNodes(
  stage: QuestStageDefinition,
  nodeIds: string[]
): QuestStageDefinition {
  if (nodeIds.length === 0) return stage;
  const removed = new Set(nodeIds);
  return {
    ...stage,
    nodeDefinitions: stage.nodeDefinitions
      .filter((node) => !removed.has(node.nodeId))
      .map((node) => ({
        ...node,
        prerequisiteNodeIds: node.prerequisiteNodeIds.filter(
          (nodeId) => !removed.has(nodeId)
        ),
        failTargetNodeIds: node.failTargetNodeIds.filter(
          (nodeId) => !removed.has(nodeId)
        )
      })),
    entryNodeIds: stage.entryNodeIds.filter((nodeId) => !removed.has(nodeId)),
    groups: normalizeNodeGroups(
      stage.groups,
      new Set(
        stage.nodeDefinitions
          .filter((node) => !removed.has(node.nodeId))
          .map((node) => node.nodeId)
      )
    )
  };
}

export function findNode(
  stage: QuestStageDefinition,
  nodeId: string
): QuestNodeDefinition | undefined {
  return stage.nodeDefinitions.find((node) => node.nodeId === nodeId);
}
