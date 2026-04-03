import { createUuid } from "../shared/identity";

export type QuestNodeBehavior = "objective" | "narrative" | "condition" | "branch";
export type QuestObjectiveSubtype =
  | "talk"
  | "location"
  | "collect"
  | "trigger"
  | "castSpell"
  | "custom";
export type QuestNarrativeSubtype = "voiceover" | "dialogue" | "cutscene" | "event";
export type QuestStageState = "active" | "completed";

export type QuestConditionDefinition =
  | { type: "hasFlag"; key: string; value?: unknown }
  | { type: "questActive"; questDefinitionId: string }
  | { type: "questCompleted"; questDefinitionId: string }
  | {
      type: "questStage";
      questDefinitionId: string;
      stageId: string;
      state: QuestStageState;
    }
  | { type: "not"; condition: QuestConditionDefinition };

export type QuestActionType =
  | "setFlag"
  | "giveItem"
  | "removeItem"
  | "playSound"
  | "spawnVfx"
  | "teleportNpc"
  | "moveNpc"
  | "setNpcState"
  | "emitEvent"
  | "custom";

export interface QuestActionDefinition {
  type: QuestActionType;
  targetId?: string;
  value?: unknown;
  position?: [number, number, number];
}

export interface QuestNodeGraphPosition {
  x: number;
  y: number;
}

export interface QuestNodeDefinition {
  nodeId: string;
  displayName: string;
  description: string;
  nodeBehavior: QuestNodeBehavior;
  objectiveSubtype?: QuestObjectiveSubtype;
  narrativeSubtype?: QuestNarrativeSubtype;
  targetId?: string;
  count?: number;
  optional?: boolean;
  dialogueDefinitionId?: string;
  completeOn?: "dialogueEnd" | string;
  autoStart?: boolean;
  prerequisiteNodeIds: string[];
  failTargetNodeIds: string[];
  condition?: QuestConditionDefinition;
  onEnterActions: QuestActionDefinition[];
  onCompleteActions: QuestActionDefinition[];
  showInHud: boolean;
  eventName?: string;
  voiceoverText?: string;
  graphPosition: QuestNodeGraphPosition;
}

export interface QuestStageDefinition {
  stageId: string;
  displayName: string;
  nextStageId: string | null;
  nodeDefinitions: QuestNodeDefinition[];
  entryNodeIds: string[];
}

export type QuestRewardType = "xp" | "item" | "currency" | "custom";

export interface QuestRewardDefinition {
  rewardId: string;
  rewardType: QuestRewardType;
  targetId?: string;
  amount?: number;
  data?: Record<string, unknown>;
}

export interface QuestDefinition {
  definitionId: string;
  displayName: string;
  description: string;
  startStageId: string;
  stageDefinitions: QuestStageDefinition[];
  rewardDefinitions: QuestRewardDefinition[];
  repeatable: boolean;
}

export const DEFAULT_QUEST_NODE_POSITION: QuestNodeGraphPosition = {
  x: 80,
  y: 80
};

export function createQuestDefinitionId(): string {
  return createUuid();
}

export function createQuestStageId(): string {
  return createUuid();
}

export function createQuestNodeId(): string {
  return createUuid();
}

export function createQuestRewardId(): string {
  return createUuid();
}

export function createDefaultQuestNodeDefinition(
  options: {
    nodeId?: string;
    displayName?: string;
    description?: string;
    nodeBehavior?: QuestNodeBehavior;
    objectiveSubtype?: QuestObjectiveSubtype;
    graphPosition?: Partial<QuestNodeGraphPosition>;
  } = {}
): QuestNodeDefinition {
  const nodeBehavior = options.nodeBehavior ?? "objective";
  return {
    nodeId: options.nodeId ?? createQuestNodeId(),
    displayName: options.displayName ?? "Objective",
    description: options.description ?? "Talk to someone",
    nodeBehavior,
    objectiveSubtype: nodeBehavior === "objective" ? options.objectiveSubtype ?? "talk" : undefined,
    narrativeSubtype: nodeBehavior === "narrative" ? "dialogue" : undefined,
    targetId: undefined,
    count: 1,
    optional: false,
    dialogueDefinitionId: undefined,
    completeOn: undefined,
    autoStart: false,
    prerequisiteNodeIds: [],
    failTargetNodeIds: [],
    condition: undefined,
    onEnterActions: [],
    onCompleteActions: [],
    showInHud: nodeBehavior === "objective",
    eventName: undefined,
    voiceoverText: undefined,
    graphPosition: {
      ...DEFAULT_QUEST_NODE_POSITION,
      ...(options.graphPosition ?? {})
    }
  };
}

export function createDefaultQuestStageDefinition(
  options: {
    stageId?: string;
    displayName?: string;
    nodeDefinitions?: QuestNodeDefinition[];
    entryNodeIds?: string[];
  } = {}
): QuestStageDefinition {
  const defaultNode = createDefaultQuestNodeDefinition();
  const nodeDefinitions = options.nodeDefinitions ?? [defaultNode];
  const entryNodeIds =
    options.entryNodeIds ??
    nodeDefinitions
      .filter((node) => node.prerequisiteNodeIds.length === 0)
      .map((node) => node.nodeId);

  return {
    stageId: options.stageId ?? createQuestStageId(),
    displayName: options.displayName ?? "Start",
    nextStageId: null,
    nodeDefinitions,
    entryNodeIds: entryNodeIds.length > 0 ? entryNodeIds : [nodeDefinitions[0]!.nodeId]
  };
}

export function createDefaultQuestDefinition(
  options: {
    definitionId?: string;
    displayName?: string;
    description?: string;
  } = {}
): QuestDefinition {
  const defaultStage = createDefaultQuestStageDefinition();
  return {
    definitionId: options.definitionId ?? createQuestDefinitionId(),
    displayName: options.displayName ?? "New Quest",
    description: options.description ?? "Quest description...",
    startStageId: defaultStage.stageId,
    stageDefinitions: [defaultStage],
    rewardDefinitions: [],
    repeatable: false
  };
}

function normalizeQuestCondition(
  condition: QuestConditionDefinition | null | undefined
): QuestConditionDefinition | undefined {
  if (!condition) return undefined;
  if (condition.type === "not") {
    const normalized = normalizeQuestCondition(condition.condition);
    return normalized ? { type: "not", condition: normalized } : undefined;
  }
  return condition;
}

function normalizeQuestAction(
  action: Partial<QuestActionDefinition> | null | undefined
): QuestActionDefinition | null {
  if (!action?.type) return null;
  return {
    type: action.type,
    targetId: action.targetId ?? undefined,
    value: action.value,
    position: action.position
      ? [action.position[0], action.position[1], action.position[2]]
      : undefined
  };
}

export function normalizeQuestNodeDefinition(
  node: Partial<QuestNodeDefinition> | null | undefined
): QuestNodeDefinition {
  const defaultNode = createDefaultQuestNodeDefinition();
  if (!node) {
    return defaultNode;
  }

  const nodeBehavior = node.nodeBehavior ?? defaultNode.nodeBehavior;

  return {
    nodeId: node.nodeId ?? defaultNode.nodeId,
    displayName: node.displayName ?? defaultNode.displayName,
    description: node.description ?? defaultNode.description,
    nodeBehavior,
    objectiveSubtype:
      nodeBehavior === "objective"
        ? node.objectiveSubtype ?? defaultNode.objectiveSubtype
        : undefined,
    narrativeSubtype:
      nodeBehavior === "narrative"
        ? node.narrativeSubtype ?? "dialogue"
        : undefined,
    targetId: node.targetId ?? undefined,
    count: node.count ?? defaultNode.count,
    optional: node.optional ?? defaultNode.optional,
    dialogueDefinitionId: node.dialogueDefinitionId ?? undefined,
    completeOn: node.completeOn ?? undefined,
    autoStart: node.autoStart ?? defaultNode.autoStart,
    prerequisiteNodeIds: [...(node.prerequisiteNodeIds ?? [])],
    failTargetNodeIds: [...(node.failTargetNodeIds ?? [])],
    condition: normalizeQuestCondition(node.condition),
    onEnterActions: (node.onEnterActions ?? [])
      .map((action) => normalizeQuestAction(action))
      .filter((action): action is QuestActionDefinition => action !== null),
    onCompleteActions: (node.onCompleteActions ?? [])
      .map((action) => normalizeQuestAction(action))
      .filter((action): action is QuestActionDefinition => action !== null),
    showInHud: node.showInHud ?? (nodeBehavior === "objective"),
    eventName: node.eventName ?? undefined,
    voiceoverText: node.voiceoverText ?? undefined,
    graphPosition: {
      ...DEFAULT_QUEST_NODE_POSITION,
      ...(node.graphPosition ?? {})
    }
  };
}

export function normalizeQuestStageDefinition(
  stage: Partial<QuestStageDefinition> | null | undefined
): QuestStageDefinition {
  const defaultStage = createDefaultQuestStageDefinition();
  if (!stage) {
    return defaultStage;
  }

  const nodeDefinitions = (stage.nodeDefinitions ?? []).map((node) =>
    normalizeQuestNodeDefinition(node)
  );
  const normalizedNodes = nodeDefinitions.length > 0 ? nodeDefinitions : defaultStage.nodeDefinitions;
  const validNodeIds = new Set(normalizedNodes.map((node) => node.nodeId));
  const entryNodeIds = (stage.entryNodeIds ?? [])
    .filter((nodeId): nodeId is string => validNodeIds.has(nodeId));

  return {
    stageId: stage.stageId ?? defaultStage.stageId,
    displayName: stage.displayName ?? defaultStage.displayName,
    nextStageId: stage.nextStageId ?? null,
    nodeDefinitions: normalizedNodes,
    entryNodeIds:
      entryNodeIds.length > 0
        ? entryNodeIds
        : normalizedNodes
            .filter((node) => node.prerequisiteNodeIds.length === 0)
            .map((node) => node.nodeId)
  };
}

function normalizeQuestRewardDefinition(
  reward: Partial<QuestRewardDefinition> | null | undefined
): QuestRewardDefinition | null {
  if (!reward?.rewardType) return null;
  return {
    rewardId: reward.rewardId ?? createQuestRewardId(),
    rewardType: reward.rewardType,
    targetId: reward.targetId ?? undefined,
    amount: reward.amount ?? undefined,
    data: reward.data ?? undefined
  };
}

export function normalizeQuestDefinition(
  definition: Partial<QuestDefinition> | null | undefined
): QuestDefinition {
  const defaultDefinition = createDefaultQuestDefinition();
  if (!definition) {
    return defaultDefinition;
  }

  const stageDefinitions = (definition.stageDefinitions ?? [])
    .map((stage) => normalizeQuestStageDefinition(stage));
  const normalizedStages = stageDefinitions.length > 0 ? stageDefinitions : defaultDefinition.stageDefinitions;
  const validStageIds = new Set(normalizedStages.map((stage) => stage.stageId));

  return {
    definitionId: definition.definitionId ?? defaultDefinition.definitionId,
    displayName: definition.displayName ?? defaultDefinition.displayName,
    description: definition.description ?? defaultDefinition.description,
    startStageId:
      definition.startStageId && validStageIds.has(definition.startStageId)
        ? definition.startStageId
        : normalizedStages[0]!.stageId,
    stageDefinitions: normalizedStages,
    rewardDefinitions: (definition.rewardDefinitions ?? [])
      .map((reward) => normalizeQuestRewardDefinition(reward))
      .filter((reward): reward is QuestRewardDefinition => reward !== null),
    repeatable: definition.repeatable ?? defaultDefinition.repeatable
  };
}
