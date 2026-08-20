/**
 * packages/workspaces/src/design/dialogue-graph.ts
 *
 * Purpose: translates a dialogue into the shared node editor's nodes and
 * connections, and turns editor gestures back into new dialogue data. Pure
 * functions, so the translation can be unit tested without a browser.
 *
 * Status: active
 */

import { normalizeNodeGroups } from "@sugarmagic/domain";
import type {
  DialogueDefinition,
  DialogueNodeDefinition
} from "@sugarmagic/domain";
import type {
  GraphEditorEdge,
  GraphEditorNode,
  GraphEditorNodeMove
} from "@sugarmagic/ui/node-editor";

export const DIALOGUE_NODE_KIND = "dialogue-node";

/** What the dialogue node card needs in order to draw itself. */
export interface DialogueNodePayload {
  node: DialogueNodeDefinition;
  isStart: boolean;
  isPlaytestActive: boolean;
}

const CHOICE_COLORS = [
  "var(--sm-accent-blue)",
  "var(--sm-accent-green)",
  "var(--sm-accent-yellow)",
  "var(--sm-accent-red)",
  "var(--sm-accent-mauve)"
];

export function choiceColor(index: number): string {
  return CHOICE_COLORS[index % CHOICE_COLORS.length] ?? CHOICE_COLORS[0]!;
}

export function choicePortName(index: number): string {
  return `choice-${index}`;
}

/**
 * A connection is identified by its source node and its position in that node's
 * `next` array. Position is part of the identity because the order decides which
 * choice port a connection leaves from, and two connections from one node are
 * distinguishable only by where they sit in the list.
 */
export function dialogueEdgeId(fromNodeId: string, index: number): string {
  return `next:${fromNodeId}#${index}`;
}

export function parseDialogueEdgeId(
  edgeId: string
): { fromNodeId: string; index: number } | null {
  if (!edgeId.startsWith("next:")) return null;
  const body = edgeId.slice("next:".length);
  const hash = body.lastIndexOf("#");
  if (hash < 0) return null;
  const fromNodeId = body.slice(0, hash);
  const index = Number(body.slice(hash + 1));
  if (!fromNodeId || !Number.isInteger(index) || index < 0) return null;
  return { fromNodeId, index };
}

export function dialogueToEditorNodes(
  dialogue: DialogueDefinition,
  playtestNodeId: string | null
): GraphEditorNode[] {
  return dialogue.nodes.map((node) => ({
    id: node.nodeId,
    kind: DIALOGUE_NODE_KIND,
    position: { ...node.graphPosition },
    payload: {
      node,
      isStart: node.nodeId === dialogue.startNodeId,
      isPlaytestActive: node.nodeId === playtestNodeId
    } satisfies DialogueNodePayload,
    // A node with a single continuation needs no named port. More than one and
    // each choice leaves from its own, spaced down the node's right edge.
    outputs:
      node.next.length > 1
        ? node.next.map((_, index) => ({
            name: choicePortName(index),
            color: choiceColor(index),
            yPercent: (index + 1) / (node.next.length + 1)
          }))
        : undefined
  }));
}

export function dialogueToEditorEdges(
  dialogue: DialogueDefinition
): GraphEditorEdge[] {
  const edges: GraphEditorEdge[] = [];
  for (const node of dialogue.nodes) {
    const isChoice = node.next.length > 1;
    node.next.forEach((edge, index) => {
      edges.push({
        id: dialogueEdgeId(node.nodeId, index),
        fromId: node.nodeId,
        toId: edge.targetNodeId,
        fromPort: isChoice ? choicePortName(index) : undefined,
        // A conditional connection is drawn dashed and in the condition colour,
        // so a gated path is visible without opening the inspector.
        color: edge.condition
          ? "var(--sm-accent-yellow)"
          : isChoice
            ? choiceColor(index)
            : "var(--sm-color-overlay0)",
        dashed: Boolean(edge.condition)
      });
    });
  }
  return edges;
}

export function applyDialogueNodeMoves(
  dialogue: DialogueDefinition,
  moves: GraphEditorNodeMove[]
): DialogueDefinition {
  if (moves.length === 0) return dialogue;
  const byId = new Map(moves.map((move) => [move.id, move.position]));
  return {
    ...dialogue,
    nodes: dialogue.nodes.map((node) => {
      const position = byId.get(node.nodeId);
      return position ? { ...node, graphPosition: { ...position } } : node;
    })
  };
}

/**
 * Adds a continuation to the source node. A connection dragged from a choice
 * port gets starting choice text; the first connection out of a node does not,
 * because a node with one continuation is not a choice.
 */
export function connectDialogueNodes(
  dialogue: DialogueDefinition,
  connection: { fromId: string; toId: string; fromPort?: string }
): DialogueDefinition {
  const { fromId, toId, fromPort } = connection;
  const fromNode = dialogue.nodes.find((node) => node.nodeId === fromId);
  if (!fromNode) return dialogue;
  if (!dialogue.nodes.some((node) => node.nodeId === toId)) return dialogue;
  if (fromNode.next.some((edge) => edge.targetNodeId === toId)) return dialogue;

  const next = [...fromNode.next];
  if (fromPort?.startsWith("choice-")) {
    next.push({ targetNodeId: toId, choiceText: `Choice ${next.length + 1}` });
  } else {
    next.push({ targetNodeId: toId });
  }

  return {
    ...dialogue,
    nodes: dialogue.nodes.map((node) =>
      node.nodeId === fromId ? { ...node, next } : node
    )
  };
}

/**
 * Removes connections by id. Several ids from one node are removed in a single
 * pass, highest index first, so earlier removals do not shift the indexes of the
 * ones still to go.
 */
export function disconnectDialogueEdges(
  dialogue: DialogueDefinition,
  edgeIds: string[]
): DialogueDefinition {
  const byNode = new Map<string, number[]>();
  for (const edgeId of edgeIds) {
    const parsed = parseDialogueEdgeId(edgeId);
    if (!parsed) continue;
    const indexes = byNode.get(parsed.fromNodeId) ?? [];
    indexes.push(parsed.index);
    byNode.set(parsed.fromNodeId, indexes);
  }
  if (byNode.size === 0) return dialogue;

  return {
    ...dialogue,
    nodes: dialogue.nodes.map((node) => {
      const indexes = byNode.get(node.nodeId);
      if (!indexes) return node;
      const removed = new Set(indexes);
      return {
        ...node,
        next: node.next.filter((_, index) => !removed.has(index))
      };
    })
  };
}

/**
 * Removes nodes and every connection pointing at them. A connection left aimed
 * at a node that no longer exists would dead-end the conversation.
 */
export function deleteDialogueNodes(
  dialogue: DialogueDefinition,
  nodeIds: string[]
): DialogueDefinition {
  if (nodeIds.length === 0) return dialogue;
  const removed = new Set(nodeIds);
  const nodes = dialogue.nodes
    .filter((node) => !removed.has(node.nodeId))
    .map((node) => ({
      ...node,
      next: node.next.filter((edge) => !removed.has(edge.targetNodeId))
    }));

  return {
    ...dialogue,
    nodes,
    // Deleting the start node repoints the start, the same way the load path
    // does. Leaving it naming a deleted node makes Playtest start from nothing
    // and gives no sign why, until the project is reloaded.
    startNodeId: nodes.some((node) => node.nodeId === dialogue.startNodeId)
      ? dialogue.startNodeId
      : (nodes[0]?.nodeId ?? null),
    groups: normalizeNodeGroups(
      dialogue.groups,
      new Set(nodes.map((node) => node.nodeId))
    )
  };
}

export interface DialogueDeleteRefusal {
  allowed: boolean;
  /** Why it was refused, ready to show the author. */
  reason?: string;
}

/**
 * A dialogue may be emptied completely -- that is a legitimate way to start
 * over. The one thing it may not become is a set of nodes with no way in.
 */
export function canDeleteDialogueNodes(
  dialogue: DialogueDefinition,
  nodeIds: string[]
): DialogueDeleteRefusal {
  if (nodeIds.length === 0) return { allowed: true };
  const removed = new Set(nodeIds);
  const remaining = dialogue.nodes.filter((node) => !removed.has(node.nodeId));

  // Clearing a dialogue out entirely is allowed -- an empty dialogue is a
  // legitimate starting point. What is not allowed is removing the node the
  // conversation opens from while other nodes remain, which would strand them
  // with no way in.
  if (
    dialogue.startNodeId &&
    nodeIds.includes(dialogue.startNodeId) &&
    remaining.length > 0
  ) {
    return {
      allowed: false,
      reason:
        "The start node cannot be deleted while other nodes remain. Delete those first, or pick a different start node."
    };
  }
  return { allowed: true };
}
