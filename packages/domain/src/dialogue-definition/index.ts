import { createUuid } from "../shared/identity";

export type DialogueBuiltInSpeakerKind =
  | "player"
  | "player-vo"
  | "narrator"
  | "excerpt";

export interface DialogueBuiltInSpeaker {
  speakerId: string;
  displayName: string;
  kind: DialogueBuiltInSpeakerKind;
}

export const PLAYER_SPEAKER: DialogueBuiltInSpeaker = {
  speakerId: "e095b3b2-3351-403a-abe1-88861fa489ad",
  displayName: "Player",
  kind: "player"
};

export const PLAYER_VO_SPEAKER: DialogueBuiltInSpeaker = {
  speakerId: "b4e9d2a1-6f3c-4b8e-a7d1-5c9e2f3a4b5c",
  displayName: "Player (VO)",
  kind: "player-vo"
};

export const NARRATOR_SPEAKER: DialogueBuiltInSpeaker = {
  speakerId: "1a44e7dd-fd2c-4862-a489-59692155e406",
  displayName: "Narrator",
  kind: "narrator"
};

export const EXCERPT_SPEAKER: DialogueBuiltInSpeaker = {
  speakerId: "a3f8c1d2-7e4b-4a9f-b6d5-1c2e3f4a5b6d",
  displayName: "Excerpt",
  kind: "excerpt"
};

export const BUILT_IN_DIALOGUE_SPEAKERS: DialogueBuiltInSpeaker[] = [
  PLAYER_SPEAKER,
  PLAYER_VO_SPEAKER,
  NARRATOR_SPEAKER,
  EXCERPT_SPEAKER
];

export type DialogueCondition =
  | { type: "flag"; key: string; value?: unknown }
  | { type: "hasItem"; itemId: string; count?: number }
  | { type: "questActive"; questId: string }
  | { type: "questCompleted"; questId: string }
  | {
      type: "questStage";
      questId: string;
      stageId: string;
      state: "active" | "completed";
    }
  | { type: "not"; condition: DialogueCondition };

export interface DialogueNodePosition {
  x: number;
  y: number;
}

export interface DialogueEdgeDefinition {
  targetNodeId: string;
  choiceText?: string;
  condition?: DialogueCondition;
}

export interface DialogueNodeDefinition {
  nodeId: string;
  displayName?: string;
  speakerId?: string;
  speakerLabel?: string;
  text: string;
  onEnterEventId?: string;
  next: DialogueEdgeDefinition[];
  graphPosition: DialogueNodePosition;
}

export interface DialogueInteractionBinding {
  npcDefinitionId: string | null;
}

export interface DialogueDefinition {
  definitionId: string;
  displayName: string;
  startNodeId: string;
  nodes: DialogueNodeDefinition[];
  interactionBinding: DialogueInteractionBinding;
}

export const DEFAULT_DIALOGUE_NODE_POSITION: DialogueNodePosition = {
  x: 80,
  y: 80
};

export function createDialogueDefinitionId(): string {
  return createUuid();
}

export function createDialogueNodeId(): string {
  return createUuid();
}

export function createDefaultDialogueNodeDefinition(
  options: {
    nodeId?: string;
    displayName?: string;
    speakerId?: string;
    text?: string;
    graphPosition?: Partial<DialogueNodePosition>;
  } = {}
): DialogueNodeDefinition {
  return {
    nodeId: options.nodeId ?? createDialogueNodeId(),
    displayName: options.displayName ?? "Start",
    speakerId: options.speakerId,
    text: options.text ?? "Hello!",
    next: [],
    graphPosition: {
      ...DEFAULT_DIALOGUE_NODE_POSITION,
      ...(options.graphPosition ?? {})
    }
  };
}

export function createDefaultDialogueDefinition(
  options: {
    definitionId?: string;
    displayName?: string;
    npcDefinitionId?: string | null;
  } = {}
): DialogueDefinition {
  const startNode = createDefaultDialogueNodeDefinition();

  return {
    definitionId: options.definitionId ?? createDialogueDefinitionId(),
    displayName: options.displayName ?? "New Dialogue",
    startNodeId: startNode.nodeId,
    nodes: [startNode],
    interactionBinding: {
      npcDefinitionId: options.npcDefinitionId ?? null
    }
  };
}

function normalizeDialogueCondition(
  condition: DialogueCondition | null | undefined
): DialogueCondition | undefined {
  if (!condition) return undefined;

  if (condition.type === "not") {
    const normalizedInner = normalizeDialogueCondition(condition.condition);
    return normalizedInner
      ? { type: "not", condition: normalizedInner }
      : undefined;
  }

  return condition;
}

function normalizeDialogueEdgeDefinition(
  edge: Partial<DialogueEdgeDefinition> | null | undefined
): DialogueEdgeDefinition | null {
  if (!edge?.targetNodeId) return null;

  return {
    targetNodeId: edge.targetNodeId,
    choiceText: edge.choiceText ?? undefined,
    condition: normalizeDialogueCondition(edge.condition)
  };
}

export function normalizeDialogueNodeDefinition(
  node: Partial<DialogueNodeDefinition> | null | undefined
): DialogueNodeDefinition {
  const defaultNode = createDefaultDialogueNodeDefinition();

  if (!node) {
    return defaultNode;
  }

  return {
    nodeId: node.nodeId ?? defaultNode.nodeId,
    displayName: node.displayName ?? defaultNode.displayName,
    speakerId: node.speakerId ?? undefined,
    speakerLabel: node.speakerLabel ?? undefined,
    text: node.text ?? defaultNode.text,
    onEnterEventId: node.onEnterEventId ?? undefined,
    next: (node.next ?? [])
      .map((edge) => normalizeDialogueEdgeDefinition(edge))
      .filter((edge): edge is DialogueEdgeDefinition => edge !== null),
    graphPosition: {
      ...DEFAULT_DIALOGUE_NODE_POSITION,
      ...(node.graphPosition ?? {})
    }
  };
}

export function normalizeDialogueDefinition(
  definition: Partial<DialogueDefinition> | null | undefined
): DialogueDefinition {
  const defaultDefinition = createDefaultDialogueDefinition();

  if (!definition) {
    return defaultDefinition;
  }

  const nodes = (definition.nodes ?? [])
    .map((node) => normalizeDialogueNodeDefinition(node))
    .filter((node) => Boolean(node.nodeId));

  const normalizedNodes = nodes.length > 0 ? nodes : defaultDefinition.nodes;
  const startNodeId =
    definition.startNodeId &&
    normalizedNodes.some((node) => node.nodeId === definition.startNodeId)
      ? definition.startNodeId
      : normalizedNodes[0]!.nodeId;

  return {
    definitionId: definition.definitionId ?? defaultDefinition.definitionId,
    displayName: definition.displayName ?? defaultDefinition.displayName,
    startNodeId,
    nodes: normalizedNodes,
    interactionBinding: {
      npcDefinitionId: definition.interactionBinding?.npcDefinitionId ?? null
    }
  };
}
