import { createUuid } from "../shared/identity";
import { normalizeNodeGroups, type NodeGroup } from "../graph-layout/index";
import type {
  NPCAnimationSlot,
  NPCInteractionMode
} from "../npc-definition/index";

// Plan 074 §074.1' -- canonical location; runtime-core re-exports from here.
export type TimeOfDayBand =
  | "dawn"
  | "morning"
  | "midday"
  | "afternoon"
  | "dusk"
  | "evening"
  | "night";

/**
 * What an author reads for each band. Exhaustive over TimeOfDayBand, so adding
 * a band without a label fails the typecheck. Key order is clock order, and
 * picker order everywhere.
 */
const TIME_OF_DAY_BAND_LABELS: Record<TimeOfDayBand, string> = {
  dawn: "Dawn",
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  dusk: "Dusk",
  evening: "Evening",
  night: "Night"
};

/** Every band, in clock order. The one list; nothing else spells them out. */
export const TIME_OF_DAY_BANDS = Object.keys(
  TIME_OF_DAY_BAND_LABELS
  // Object.keys widens to string; the Record is keyed by TimeOfDayBand.
) as TimeOfDayBand[];

/** Every band as a picker option. */
export const TIME_OF_DAY_BAND_OPTIONS: Array<{
  value: TimeOfDayBand;
  label: string;
}> = TIME_OF_DAY_BANDS.map((value) => ({
  value,
  label: TIME_OF_DAY_BAND_LABELS[value]
}));

export function isTimeOfDayBand(value: unknown): value is TimeOfDayBand {
  return (
    typeof value === "string" && (TIME_OF_DAY_BANDS as string[]).includes(value)
  );
}

export type QuestNodeBehavior = "objective" | "narrative" | "condition" | "branch";
export type QuestObjectiveSubtype =
  | "talk"
  // Arrival is authored here: pick the area the player has to reach. Areas are
  // the label-role view of region volumes, so a box the player can be "in" is
  // already an area -- there is no second arrival subtype.
  | "location"
  | "collect"
  | "castSpell"
  | "assessment"
  // Completes when a named quest event fires -- `eventName` on the node,
  // emitted by an `emitEvent` action or by a plugin. The only subtype whose
  // completion the quest system does not detect for itself.
  | "awaitEvent";
// `voiceover` and `cutscene` activate and complete in the same tick -- nothing
// plays them yet. They are kept because both are wanted: a cutscene at a point
// in a quest, and a way to author narration.
export type QuestNarrativeSubtype = "voiceover" | "dialogue" | "cutscene";
export type QuestStageState = "active" | "completed";

export type QuestConditionDefinition =
  // `worldFlagId` references a WorldFlagDefinition, not the runtime store's key. The
  // runtime resolves it to that flag's name before comparing.
  | { type: "hasFlag"; worldFlagId: string; value?: unknown }
  | { type: "hasSpell"; spellDefinitionId: string }
  | { type: "canCastSpell"; spellDefinitionId: string }
  | { type: "questActive"; questDefinitionId: string }
  | { type: "questCompleted"; questDefinitionId: string }
  | {
      type: "questStage";
      questDefinitionId: string;
      stageId: string;
      state: QuestStageState;
    }
  | { type: "not"; condition: QuestConditionDefinition };

/**
 * What a quest node does when it activates or completes. Each action names its
 * own parameters, so the type says what an action takes and the editor and the
 * runtime read the same named fields. Same shape as QuestConditionDefinition
 * above.
 *
 * A reference an author has not chosen yet is null. The runtime skips an action
 * whose reference is missing rather than guessing.
 */
export type QuestActionDefinition =
  // Sets a runtime flag. Mirrors the `hasFlag` condition.
  | { type: "setFlag"; worldFlagId: string; value?: unknown }
  // Fires a quest event, completing any active node waiting on that name.
  | { type: "emitEvent"; eventName: string }
  | { type: "giveItem"; itemDefinitionId: string | null; count: number }
  | { type: "removeItem"; itemDefinitionId: string | null; count: number }
  // Campaign progression. `unlockEpisode` opens an Episode's gate by adding
  // it to campaign.progression's manual unlocks -- Episodes are gated, Scenes
  // are not, so there is no unlockScene. `advanceToNextScene` completes the
  // current Scene and moves the player into `sceneId`, or into the next Scene
  // of the current Episode when it is null; running off the end of an Episode
  // is the Episode boundary, where credits roll.
  | { type: "unlockEpisode"; episodeId: string | null }
  | { type: "advanceToNextScene"; sceneId: string | null }
  | { type: "playCue"; cueDefinitionId: string | null }
  // Stops a cue this same source started. The runtime keys a sounding
  // instance by where the action ran -- a quest node, or a volume -- so a
  // volume's exit list stops what its enter list began without naming an
  // instance.
  | { type: "stopCue"; cueDefinitionId: string | null }
  // Moves the player into another region, landing on one of that region's
  // markers. A null `markerId` means the region's own player start, which
  // is the only sensible default when a region has no marker yet.
  //
  // Distinct from `advanceToNextScene`, which completes the current Scene
  // and moves the STORY on. This is a doorway: the story does not change,
  // the player just walks somewhere else.
  | { type: "goToRegion"; regionId: string | null; markerId: string | null }
  // Overrides an NPC's interaction mode from here on, or clears the override
  // with a null `mode` so the NPC falls back to its authored definition.
  // Targets the DEFINITION, so it reaches every presence of that NPC --
  // same reach as `playAnimation`. Persisted, so it survives a reload.
  | {
      type: "setNpcInteractionMode";
      npcDefinitionId: string | null;
      mode: NPCInteractionMode | null;
    }
  // Plays one of the NPC's bound animation slots `repeatCount` times through,
  // then hands the NPC back to its normal locomotion animation. Every presence
  // of that NPC in the scene plays.
  | {
      type: "playAnimation";
      npcDefinitionId: string | null;
      slot: NPCAnimationSlot | null;
      repeatCount: number;
    }
  // Plan 074 §074.1' -- Beat-driven world clock.
  | { type: "set-time-of-day"; band: TimeOfDayBand }
  | { type: "advance-day" }
  // Plan 074 §074.5 -- Player-known-facts. `factId` is the dedup key and
  // `displayText` is what the player reads. Quest actions only, no dialogue
  // node surface.
  | { type: "learn-fact"; factId: string | null; displayText: string };

/**
 * Three actions this list deliberately does not have, and what to do instead.
 *
 * - Playing a world-space effect. There is no effect system to route one to.
 *   Add the action back alongside one, when a story beat needs an authored
 *   effect at a place -- sparkles over the shrine as an offering node
 *   completes, say -- and it can answer whether the effect anchors to a world
 *   position or to an NPC or asset. Unrelated and staying: the `vfx-spawn`
 *   gameplay placement kind and the content library's `vfx` definition kind.
 * - Walking an NPC somewhere. That is the behavior system's: author the NPC a
 *   task with a target area and an activation.
 * - Flipping an NPC between scripted and agentified. #207 gives that a
 *   purpose-named action with defined semantics.
 * - Putting an NPC somewhere. Place the NPC twice and condition each placement
 *   on the quest state that should reveal it -- including "after node Z", which
 *   the activation grammar evaluates. The placement that matches is the one in
 *   the world, so the NPC is simply where the story says, with no instant move
 *   to author and no walking route to unwind.
 * - A `custom` escape hatch. There is nothing to escape to: no plugin
 *   contribution kind is a quest action handler, and `setActionHandler` has one
 *   implementer, owned by the host. `emitEvent` already covers "fire a named
 *   thing and let whatever is listening react". Plugin-authored actions would
 *   be a real feature -- a contribution kind, a registry keyed by action name,
 *   and an editor that asks the plugin what parameters it takes -- and a
 *   purpose-named member added then beats one kept warm now.
 */

export type QuestActionType = QuestActionDefinition["type"];

/**
 * What an author reads in the action picker, one label per action type.
 * The Record is exhaustive over QuestActionType, so adding a member to the
 * union without a label here fails the typecheck. Key order is picker order.
 */
const QUEST_ACTION_TYPE_LABELS: Record<QuestActionType, string> = {
  setFlag: "Set Flag",
  emitEvent: "Emit Event",
  giveItem: "Give Item",
  removeItem: "Remove Item",
  unlockEpisode: "Unlock Episode",
  advanceToNextScene: "Advance to Next Scene",
  "set-time-of-day": "Set Time of Day",
  "advance-day": "Advance Day",
  "learn-fact": "Learn Fact",
  playCue: "Play Cue",
  stopCue: "Stop Cue",
  goToRegion: "Go to Region",
  setNpcInteractionMode: "Set NPC Interaction Mode",
  playAnimation: "Play Animation"
};

/**
 * The one list every quest action picker in Studio renders. It is built from
 * the label Record, so it covers every action type the runtime can be handed.
 */
export const QUEST_ACTION_TYPE_OPTIONS: Array<{
  value: QuestActionType;
  label: string;
}> = Object.entries(QUEST_ACTION_TYPE_LABELS).map(([value, label]) => ({
  // Object.entries widens the key to string. The Record is keyed by
  // QuestActionType, so every key is one.
  value: value as QuestActionType,
  label
}));

/**
 * An action of the given type with nothing chosen yet. The editor uses this
 * when an author adds an action, and the normalizer when it reads one whose
 * fields are missing.
 */
export function createQuestAction(type: QuestActionType): QuestActionDefinition {
  switch (type) {
    case "setFlag":
      // The value is spelled out rather than left blank: a condition compares
      // against it with `===`, so an author has to see what they are setting.
      return { type, worldFlagId: "", value: "true" };
    case "emitEvent":
      return { type, eventName: "" };
    case "giveItem":
    case "removeItem":
      return { type, itemDefinitionId: null, count: 1 };
    case "unlockEpisode":
      return { type, episodeId: null };
    case "advanceToNextScene":
      return { type, sceneId: null };
    case "playCue":
    case "stopCue":
      return { type, cueDefinitionId: null };
    case "goToRegion":
      return { type, regionId: null, markerId: null };
    case "setNpcInteractionMode":
      // Null mode = clear the override. The author picks the NPC and
      // the mode; both start unset.
      return { type, npcDefinitionId: null, mode: null };
    case "playAnimation":
      return { type, npcDefinitionId: null, slot: null, repeatCount: 1 };
    case "set-time-of-day":
      return { type, band: "morning" };
    case "learn-fact":
      return { type, factId: null, displayText: "" };
    case "advance-day":
      return { type };
    default: {
      const exhaustive: never = type;
      throw new Error(
        `[quest-definition] createQuestAction has no shape for action type "${String(exhaustive)}". Add one beside the variant.`
      );
    }
  }
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
  /**
   * The area a `location` objective completes on. The player entering it, or
   * any area nested inside it, completes the node.
   *
   * Named rather than folded into `targetId`, which already means an item id,
   * an NPC id or a spell id depending on the subtype.
   */
  targetAreaId?: string;
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
  /**
   * Labelled boxes drawn around nodes. Layout only, and optional: a document
   * saved before groups existed has no value here, and there is no migration
   * step to add one. The normalizer fills it with an empty list on load, so
   * anything that has been through the load path always has it.
   */
  groups?: NodeGroup[];
  /**
   * The time of day this stage takes place at. Set when the stage becomes
   * active. `null` means the stage leaves the clock alone.
   *
   * A stage is usually authored as a scene at a time -- "the dock, late
   * afternoon" -- so the time belongs to the stage rather than to an action
   * on whichever node happens to run first.
   */
  timeOfDay: TimeOfDayBand | null;
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
  /**
   * When this quest becomes active (epic #226). Absent means at boot,
   * which is what every quest did before this existed -- so a project
   * written without it behaves exactly as it always has.
   *
   * The same grammar quest NODES use, deliberately: `questCompleted`
   * chains one quest to another, which is how an errand spanning two
   * Scenes is authored, and `QuestManager` already evaluates every case
   * against quest state.
   */
  startCondition?: QuestConditionDefinition;
  startStageId: string;
  stageDefinitions: QuestStageDefinition[];
  rewardDefinitions: QuestRewardDefinition[];
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
    timeOfDay?: TimeOfDayBand | null;
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
    groups: [],
    entryNodeIds:
      entryNodeIds.length > 0
        ? entryNodeIds
        : nodeDefinitions[0]
          ? [nodeDefinitions[0].nodeId]
          : [],
    timeOfDay: options.timeOfDay ?? null
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
  if (condition.type === "hasFlag") {
    // Pre-206 files hold a flag NAME in `key`. Carried through as if it were
    // an id; the load-time flag migration turns it into a real reference.
    const legacyKey = readString(
      (condition as unknown as Record<string, unknown>).key
    );
    return { ...condition, worldFlagId: condition.worldFlagId ?? legacyKey ?? "" };
  }
  return condition;
}

const QUEST_ACTION_TYPES = new Set<string>(
  Object.keys(QUEST_ACTION_TYPE_LABELS)
);

function isNpcAnimationSlot(value: unknown): value is NPCAnimationSlot {
  return value === "idle" || value === "walk" || value === "run";
}

/** A count of at least 1, from a number, a numeric string, or nothing. */
function normalizeActionCount(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : 1;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads an action from a project file into its variant.
 *
 * Actions written before each type declared its own parameters carry a single
 * `targetId` that meant something different per type, plus a `value` that meant
 * a count, a flag value, or display text. Each case below reads its named field
 * and falls back to those, so an older project keeps working.
 */
export function normalizeQuestAction(action: unknown): QuestActionDefinition | null {
  if (!action || typeof action !== "object") return null;
  const source = action as Record<string, unknown>;
  const rawType = source.type;
  if (typeof rawType !== "string" || !QUEST_ACTION_TYPES.has(rawType)) {
    return null;
  }
  // QUEST_ACTION_TYPES is built from the label Record's keys, so a string it
  // contains is a QuestActionType.
  const type = rawType as QuestActionType;

  // `targetId` was the one reference field every action shared.
  const legacyTargetId = readString(source.targetId);

  switch (type) {
    case "setFlag":
      // Pre-206 files hold a flag NAME in `key`. It is carried through here as
      // if it were an id; the load-time flag migration turns it into a real
      // reference once it can see the whole project.
      return {
        type: "setFlag",
        worldFlagId:
          readString(source.worldFlagId) ??
          readString(source.key) ??
          legacyTargetId ??
          "",
        value: source.value
      };
    case "emitEvent":
      return {
        type: "emitEvent",
        eventName: readString(source.eventName) ?? legacyTargetId ?? ""
      };
    case "giveItem":
    case "removeItem":
      return {
        type,
        itemDefinitionId: readString(source.itemDefinitionId) ?? legacyTargetId,
        count: normalizeActionCount(
          source.count !== undefined ? source.count : source.value
        )
      };
    case "unlockEpisode":
      return {
        type,
        episodeId: readString(source.episodeId) ?? legacyTargetId
      };
    case "advanceToNextScene":
      return {
        type,
        sceneId: readString(source.sceneId) ?? legacyTargetId
      };
    case "playCue":
    case "stopCue":
      return {
        type,
        cueDefinitionId: readString(source.cueDefinitionId) ?? legacyTargetId
      };
    case "goToRegion":
      return {
        type,
        regionId: readString(source.regionId) ?? legacyTargetId,
        markerId: readString(source.markerId) ?? null
      };
    case "setNpcInteractionMode": {
      const mode = readString(source.mode);
      return {
        type: "setNpcInteractionMode",
        npcDefinitionId: readString(source.npcDefinitionId) ?? legacyTargetId,
        // Anything outside the union normalizes to null, which means
        // "clear the override" rather than a hard failure -- an authored
        // mode removed from the union should hand the NPC back to its
        // definition, not strand the action.
        mode: mode === "scripted" || mode === "agent" ? mode : null
      };
    }
    case "playAnimation": {
      const slot = readString(source.slot);
      return {
        type: "playAnimation",
        npcDefinitionId: readString(source.npcDefinitionId) ?? legacyTargetId,
        slot: isNpcAnimationSlot(slot) ? slot : null,
        repeatCount: normalizeActionCount(source.repeatCount)
      };
    }
    case "set-time-of-day": {
      const band = readString(source.band) ?? legacyTargetId;
      return {
        type: "set-time-of-day",
        band: isTimeOfDayBand(band) ? band : "morning"
      };
    }
    case "learn-fact":
      return {
        type: "learn-fact",
        factId: readString(source.factId) ?? legacyTargetId,
        displayText:
          readString(source.displayText) ??
          (typeof source.value === "string" ? source.value : "")
      };
    case "advance-day":
      return { type };
    default: {
      const exhaustive: never = type;
      void exhaustive;
      return null;
    }
  }
}

/**
 * `custom` was this subtype's name before it said what it does. An objective
 * authored under the old name is an awaitEvent objective.
 */
function normalizeObjectiveSubtype(
  value: unknown
): QuestObjectiveSubtype | undefined {
  if (value === "custom") return "awaitEvent";
  return typeof value === "string"
    ? (value as QuestObjectiveSubtype)
    : undefined;
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
        ? normalizeObjectiveSubtype(node.objectiveSubtype) ??
          defaultNode.objectiveSubtype
        : undefined,
    narrativeSubtype:
      nodeBehavior === "narrative"
        ? node.narrativeSubtype ?? "dialogue"
        : undefined,
    targetId: node.targetId ?? undefined,
    targetAreaId: node.targetAreaId ?? undefined,
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
  // An emptied stage stays empty. Substituting a starter node here would undo
  // the author's deletion on the next load rather than on screen, which is the
  // confusing place to find out about it.
  const normalizedNodes = nodeDefinitions;
  const validNodeIds = new Set(normalizedNodes.map((node) => node.nodeId));
  const entryNodeIds = (stage.entryNodeIds ?? [])
    .filter((nodeId): nodeId is string => validNodeIds.has(nodeId));

  return {
    stageId: stage.stageId ?? defaultStage.stageId,
    displayName: stage.displayName ?? defaultStage.displayName,
    nextStageId: stage.nextStageId ?? null,
    timeOfDay: stage.timeOfDay ?? null,
    nodeDefinitions: normalizedNodes,
    // Membership is filtered against the nodes that survived, so a group never
    // points at a node that has been deleted.
    groups: normalizeNodeGroups(stage.groups, validNodeIds),
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
    startCondition: normalizeQuestCondition(definition.startCondition),
    stageDefinitions: normalizedStages,
    rewardDefinitions: (definition.rewardDefinitions ?? [])
      .map((reward) => normalizeQuestRewardDefinition(reward))
      .filter((reward): reward is QuestRewardDefinition => reward !== null),
  };
}
