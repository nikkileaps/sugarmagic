import { createUuid } from "../shared/identity";
import { normalizeNodeGroups, type NodeGroup } from "../graph-layout/index";

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

/**
 * Whose voice a dialogue node is, resolved.
 *
 * A node stores only a bare `speakerId: string`, so "is this the player, the
 * narrator, or an NPC?" was previously answered by comparing that id against
 * the built-in constants at each call site. That produced several DIFFERENT
 * partitions of the same four-value enum across the repo. This union is the
 * resolved view; it is not a persisted shape and requires no data migration.
 *
 * Consumers should switch on `kind` rather than compare ids, so adding a
 * built-in speaker becomes a compile error at every site that cares.
 */
export type DialogueSpeakerRef =
  | { kind: "npc"; npcDefinitionId: string }
  | { kind: DialogueBuiltInSpeakerKind };

const BUILT_IN_SPEAKER_KIND_BY_ID = new Map<string, DialogueBuiltInSpeakerKind>(
  BUILT_IN_DIALOGUE_SPEAKERS.map((speaker) => [speaker.speakerId, speaker.kind])
);

/**
 * The single answer to "whose voice is this node?".
 *
 * Resolution order, which was previously folklore spread across call sites:
 *
 *   a built-in speaker id  -> that built-in kind
 *   any other id           -> an NPC, by that id
 *   no id at all           -> the dialogue's bound NPC (the authoring default:
 *                             an unset speaker on an NPC dialogue means the NPC
 *                             is talking)
 *
 * Returns `null` only when there is no speaker AND no bound NPC to fall back
 * to -- an unbound dialogue's unattributed line, which belongs to nobody.
 */
export function resolveDialogueSpeaker(
  speakerId: string | undefined | null,
  boundNpcId: string | undefined | null
): DialogueSpeakerRef | null {
  if (!speakerId) {
    return boundNpcId ? { kind: "npc", npcDefinitionId: boundNpcId } : null;
  }
  const builtInKind = BUILT_IN_SPEAKER_KIND_BY_ID.get(speakerId);
  return builtInKind
    ? { kind: builtInKind }
    : { kind: "npc", npcDefinitionId: speakerId };
}

/** Convenience for the common "which NPC, if any, said this?" question. */
export function speakerNpcDefinitionId(
  speaker: DialogueSpeakerRef | null
): string | undefined {
  return speaker?.kind === "npc" ? speaker.npcDefinitionId : undefined;
}

/**
 * Did the PLAYER say this? True for both the player and their voice-over.
 *
 * Note this is not the complement of `speakerNpcDefinitionId` -- narrator and
 * excerpt are neither the player nor an NPC. Callers that also honour a
 * runtime-supplied player id must check that separately; this covers the
 * authored built-ins only.
 */
export function isPlayerSpeaker(speaker: DialogueSpeakerRef | null): boolean {
  return speaker?.kind === "player" || speaker?.kind === "player-vo";
}

export type DialogueCondition =
  // `worldFlagId` references a WorldFlagDefinition; the runtime resolves it to a name.
  | { type: "flag"; worldFlagId: string; value?: unknown }
  | { type: "hasItem"; itemId: string; count?: number }
  | { type: "hasSpell"; spellId: string }
  | { type: "canCastSpell"; spellId: string }
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

export interface DialogueLineIntent {
  mustConveyFacts?: string[];
  beat?: string;
  voiceNote?: string;
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
  intent?: DialogueLineIntent;
  next: DialogueEdgeDefinition[];
  graphPosition: DialogueNodePosition;
}

export interface DialogueInteractionBinding {
  npcDefinitionId: string | null;
}

export interface DialogueDefinition {
  definitionId: string;
  displayName: string;
  /** Null when the dialogue has no nodes, so there is nowhere to start. */
  startNodeId: string | null;
  nodes: DialogueNodeDefinition[];
  /**
   * Labelled boxes drawn around nodes. Layout only, and optional: a document
   * saved before groups existed has no value here, and there is no migration
   * step to add one. The normalizer fills it with an empty list on load, so
   * anything that has been through the load path always has it.
   */
  groups?: NodeGroup[];
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
    groups: [],
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

  if (condition.type === "flag") {
    // Pre-206 files hold a flag NAME in `key`. Carried through as if it were
    // an id; the load-time flag migration turns it into a real reference.
    const legacyKey = (condition as unknown as Record<string, unknown>).key;
    return {
      ...condition,
      worldFlagId:
        condition.worldFlagId ?? (typeof legacyKey === "string" ? legacyKey : "")
    };
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
    ...(node.intent ? { intent: node.intent } : {}),
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

  // An emptied dialogue stays empty. Substituting a starter node here would
  // undo the author's deletion on the next load rather than on screen, which
  // is the confusing place to find out about it.
  const normalizedNodes = nodes;
  const startNodeId =
    definition.startNodeId &&
    normalizedNodes.some((node) => node.nodeId === definition.startNodeId)
      ? definition.startNodeId
      : (normalizedNodes[0]?.nodeId ?? null);

  return {
    definitionId: definition.definitionId ?? defaultDefinition.definitionId,
    displayName: definition.displayName ?? defaultDefinition.displayName,
    startNodeId,
    nodes: normalizedNodes,
    groups: normalizeNodeGroups(
      definition.groups,
      new Set(normalizedNodes.map((node) => node.nodeId))
    ),
    interactionBinding: {
      npcDefinitionId: definition.interactionBinding?.npcDefinitionId ?? null
    }
  };
}
