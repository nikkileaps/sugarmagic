import type { RegionAreaKind } from "@sugarmagic/domain";
import type { TimeOfDayBand } from "../world/time-store";

export type BlackboardScopeKind =
  | "global"
  | "region"
  | "entity"
  | "quest"
  | "conversation";

export interface BlackboardScopeRef {
  kind: BlackboardScopeKind;
  id: string;
}

export type BlackboardFactLifecycle =
  | { kind: "persistent" }
  | { kind: "session" }
  | { kind: "frame" }
  | { kind: "ephemeral"; expiresAfterMs: number };

export interface BlackboardFactDefinition<TValue> {
  key: string;
  readonly valueType?: TValue;
  ownerSystem: string;
  allowedScopeKinds: readonly BlackboardScopeKind[];
  lifecycle: BlackboardFactLifecycle;
}

export interface BlackboardFactEnvelope<TValue> {
  key: string;
  scope: BlackboardScopeRef;
  value: TValue;
  sourceSystem: string;
  updatedAtMs: number;
}

export type BlackboardChangeReason =
  | "explicit-set"
  | "explicit-clear"
  | "ephemeral-expiry"
  | "frame-advance"
  | "session-clear";

export interface BlackboardChangeEvent {
  type: "set" | "clear" | "expire";
  key: string;
  scope: BlackboardScopeRef;
  reason: BlackboardChangeReason;
  current: BlackboardFactEnvelope<unknown> | null;
  previous: BlackboardFactEnvelope<unknown> | null;
}

export type BlackboardListener = (event: BlackboardChangeEvent) => void;

export interface RuntimeBlackboardOptions {
  definitions?: readonly BlackboardFactDefinition<unknown>[];
  now?: () => number;
}

export interface BlackboardSetFactOptions<TValue> {
  definition: BlackboardFactDefinition<TValue>;
  scope: BlackboardScopeRef;
  value: TValue;
  sourceSystem: string;
  updatedAtMs?: number;
}

export interface BlackboardClearFactOptions<TValue> {
  definition: BlackboardFactDefinition<TValue>;
  scope: BlackboardScopeRef;
  sourceSystem: string;
}

export interface AreaReference {
  areaId: string | null;
  displayName: string | null;
  lorePageId: string | null;
  kind: RegionAreaKind | null;
}

export interface LocationReference {
  regionId: string | null;
  regionDisplayName: string | null;
  regionLorePageId: string | null;
  sceneId: string | null;
  sceneDisplayName: string | null;
  area: AreaReference | null;
  parentArea: AreaReference | null;
}

export interface EntityPositionFact {
  entityId: string;
  x: number;
  y: number;
  z: number;
  regionId: string | null;
  sceneId: string | null;
}

export interface EntityLocationFact {
  entityId: string;
  location: LocationReference;
}

export interface EntityCurrentAreaFact {
  entityId: string;
  area: AreaReference | null;
  parentArea: AreaReference | null;
}

export type SpatialProximityBand =
  | "immediate"
  | "local"
  | "remote";

export interface EntityPlayerSpatialRelationFact {
  entityId: string;
  playerEntityId: string;
  entityAreaId: string | null;
  playerAreaId: string | null;
  sameArea: boolean;
  sameParentArea: boolean;
  proximityBand: SpatialProximityBand;
  distanceMeters: number | null;
}

export type EntityMovementStatus = "idle" | "en_route" | "at_target" | "blocked";

export interface EntityMovementFact {
  entityId: string;
  targetAreaId: string | null;
  targetAreaDisplayName: string | null;
  status: EntityMovementStatus;
  distanceToTargetMeters: number | null;
  failureReason: "stuck" | "missing-target-area" | null;
}

export interface EntityCurrentActivityFact {
  entityId: string;
  activity: string;
}

export interface EntityCurrentGoalFact {
  entityId: string;
  goal: string;
}

export interface TrackedQuestFact {
  questId: string;
  displayName: string;
}

export interface QuestActiveStageFact {
  questId: string;
  stageId: string | null;
  stageDisplayName: string | null;
}

export interface QuestObjectiveSummary {
  nodeId: string;
  displayName: string;
  description: string;
}

export interface QuestActiveObjectivesFact {
  questId: string;
  displayName: string;
  stageId: string | null;
  stageDisplayName: string | null;
  objectives: QuestObjectiveSummary[];
}

export const ENTITY_POSITION_FACT = defineBlackboardFact<EntityPositionFact>({
  key: "entity.position",
  ownerSystem: "spatial-system",
  allowedScopeKinds: ["entity"],
  lifecycle: { kind: "frame" }
});

export const ENTITY_LOCATION_FACT = defineBlackboardFact<EntityLocationFact>({
  key: "entity.location",
  ownerSystem: "scene-system",
  allowedScopeKinds: ["entity"],
  lifecycle: { kind: "session" }
});

export const ENTITY_CURRENT_AREA_FACT = defineBlackboardFact<EntityCurrentAreaFact>({
  key: "entity.current-area",
  ownerSystem: "spatial-system",
  allowedScopeKinds: ["entity"],
  lifecycle: { kind: "frame" }
});

export const ENTITY_PLAYER_SPATIAL_RELATION_FACT =
  defineBlackboardFact<EntityPlayerSpatialRelationFact>({
    key: "entity.player-spatial-relation",
    ownerSystem: "spatial-system",
    allowedScopeKinds: ["entity"],
    lifecycle: { kind: "frame" }
  });

export const ENTITY_MOVEMENT_FACT = defineBlackboardFact<EntityMovementFact>({
  key: "entity.movement",
  ownerSystem: "movement-system",
  allowedScopeKinds: ["entity"],
  lifecycle: { kind: "session" }
});

export const ENTITY_CURRENT_ACTIVITY_FACT =
  defineBlackboardFact<EntityCurrentActivityFact>({
    key: "entity.current-activity",
    ownerSystem: "behavior-system",
    allowedScopeKinds: ["entity"],
    lifecycle: { kind: "session" }
  });

export const ENTITY_CURRENT_GOAL_FACT = defineBlackboardFact<EntityCurrentGoalFact>({
  key: "entity.current-goal",
  ownerSystem: "behavior-system",
  allowedScopeKinds: ["entity"],
  lifecycle: { kind: "session" }
});

export const TRACKED_QUEST_FACT = defineBlackboardFact<TrackedQuestFact>({
  key: "quest.tracked",
  ownerSystem: "quest-system",
  allowedScopeKinds: ["global"],
  lifecycle: { kind: "session" }
});

export const QUEST_ACTIVE_STAGE_FACT = defineBlackboardFact<QuestActiveStageFact>({
  key: "quest.active-stage",
  ownerSystem: "quest-system",
  allowedScopeKinds: ["quest"],
  lifecycle: { kind: "session" }
});

export const QUEST_ACTIVE_OBJECTIVES_FACT =
  defineBlackboardFact<QuestActiveObjectivesFact>({
    key: "quest.active-objectives",
    ownerSystem: "quest-system",
    allowedScopeKinds: ["quest"],
    lifecycle: { kind: "session" }
  });

/**
 * Plan 077 §077.3a (D4) -- world-narrative facts.
 *
 * Owned by "narrative-system" (runtime-core), written ONLY via the
 * "bump-goal-surfaced" ConversationActionProposal handler in
 * gameplay-session.ts. Sugaragent's stages never hold a blackboard handle
 * and therefore cannot write these directly -- the proposal channel is the
 * only path (see handleConversationActionProposal in gameplay-session.ts).
 */
export const NARRATIVE_SOURCE_SYSTEM = "narrative-system";

/**
 * How many times the current quest objective has been raised to the player
 * via NPC dialogue this session. Scoped per quest (questId). Lifecycle:
 * session (no persistence in v1). A count of 0 means no NPC has been
 * prompted to surface it yet.
 *
 * NOTE: this is a COARSE proxy that counts PROMPTING, not saying. PlanStage
 * bumps it when it routes the turn to voice quest context -- the model may
 * still decline to steer in character. "Second NPC eases off" is therefore
 * best-effort emergent, not guaranteed. Precise "was the beat delivered?"
 * is deferred to Epic E/075's judge.
 */
export const GOAL_SURFACED_COUNT_FACT = defineBlackboardFact<number>({
  key: "narrative.goal-surfaced-count",
  ownerSystem: NARRATIVE_SOURCE_SYSTEM,
  allowedScopeKinds: ["quest"],
  lifecycle: { kind: "session" }
});

/**
 * Plan 074 §074.2' -- world clock facts.
 *
 * Written ONLY by worldTimeStore callbacks wired in gameplay-session.ts.
 * The sole write path is quest actions (set-time-of-day / advance-day)
 * dispatched through QuestManager -> gameplay-session.setActionHandler ->
 * worldTimeStore. Direct setFact calls outside that path will throw
 * (assertWriteAllowed enforces the ownerSystem).
 */
export const WORLD_TIME_SOURCE_SYSTEM = "world-time-system";

export const WORLD_TIME_OF_DAY_FACT = defineBlackboardFact<TimeOfDayBand>({
  key: "world.time-of-day",
  ownerSystem: WORLD_TIME_SOURCE_SYSTEM,
  allowedScopeKinds: ["global"],
  lifecycle: { kind: "session" }
});

export const WORLD_DAY_FACT = defineBlackboardFact<number>({
  key: "world.day",
  ownerSystem: WORLD_TIME_SOURCE_SYSTEM,
  allowedScopeKinds: ["global"],
  lifecycle: { kind: "session" }
});

// Plan 074 §074.5 -- player-known-facts. Sole write path: learn-fact quest
// actions dispatched through QuestManager -> gameplay-session.setActionHandler
// -> playerKnownFactsStore.learnFact -> callback. The blackboard `persistent`
// lifecycle tag is inert (survives only session-clear); the SaveParticipant
// re-writes the fact array into the blackboard on restore.
export const PLAYER_FACTS_SOURCE_SYSTEM = "player-facts-system";

export const PLAYER_KNOWN_FACTS_FACT = defineBlackboardFact<string[]>({
  key: "player.known-facts",
  ownerSystem: PLAYER_FACTS_SOURCE_SYSTEM,
  allowedScopeKinds: ["global"],
  lifecycle: { kind: "session" }
});

export const RUNTIME_BLACKBOARD_FACT_DEFINITIONS = [
  ENTITY_POSITION_FACT,
  ENTITY_LOCATION_FACT,
  ENTITY_CURRENT_AREA_FACT,
  ENTITY_PLAYER_SPATIAL_RELATION_FACT,
  ENTITY_MOVEMENT_FACT,
  ENTITY_CURRENT_ACTIVITY_FACT,
  ENTITY_CURRENT_GOAL_FACT,
  TRACKED_QUEST_FACT,
  QUEST_ACTIVE_STAGE_FACT,
  QUEST_ACTIVE_OBJECTIVES_FACT,
  GOAL_SURFACED_COUNT_FACT,
  WORLD_TIME_OF_DAY_FACT,
  WORLD_DAY_FACT,
  PLAYER_KNOWN_FACTS_FACT
] as const satisfies readonly BlackboardFactDefinition<unknown>[];

export function defineBlackboardFact<TValue>(
  definition: BlackboardFactDefinition<TValue>
): BlackboardFactDefinition<TValue> {
  return definition;
}

export class RuntimeBlackboard {
  private readonly now: () => number;
  private readonly definitions = new Map<string, BlackboardFactDefinition<unknown>>();
  private readonly facts = new Map<string, BlackboardFactEnvelope<unknown>>();
  private readonly listeners = new Set<BlackboardListener>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();

  constructor(options: RuntimeBlackboardOptions = {}) {
    this.now = options.now ?? (() => Date.now());

    for (const definition of options.definitions ?? RUNTIME_BLACKBOARD_FACT_DEFINITIONS) {
      if (this.definitions.has(definition.key)) {
        throw new Error(`Duplicate blackboard fact definition for key "${definition.key}".`);
      }
      this.definitions.set(definition.key, definition);
    }
  }

  subscribe(listener: BlackboardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setFact<TValue>(options: BlackboardSetFactOptions<TValue>): BlackboardFactEnvelope<TValue> {
    const definition = this.requireDefinition(options.definition);
    this.assertWriteAllowed(definition, options.scope, options.sourceSystem);

    const storageKey = serializeFactStorageKey(definition.key, options.scope);
    const previous =
      (this.facts.get(storageKey) as BlackboardFactEnvelope<TValue> | undefined) ?? null;
    const envelope: BlackboardFactEnvelope<TValue> = {
      key: definition.key,
      scope: options.scope,
      value: options.value,
      sourceSystem: options.sourceSystem,
      updatedAtMs: options.updatedAtMs ?? this.now()
    };

    this.clearExpiryTimer(storageKey);
    this.facts.set(storageKey, envelope);
    this.scheduleExpiryIfNeeded(definition, storageKey, envelope);
    this.emit({
      type: "set",
      key: definition.key,
      scope: options.scope,
      reason: "explicit-set",
      current: envelope,
      previous
    });

    return envelope;
  }

  getFact<TValue>(
    definition: BlackboardFactDefinition<TValue>,
    scope: BlackboardScopeRef
  ): BlackboardFactEnvelope<TValue> | null {
    const resolvedDefinition = this.requireDefinition(definition);
    const storageKey = serializeFactStorageKey(resolvedDefinition.key, scope);
    return (this.facts.get(storageKey) as BlackboardFactEnvelope<TValue> | undefined) ?? null;
  }

  clearFact<TValue>(options: BlackboardClearFactOptions<TValue>): void {
    const definition = this.requireDefinition(options.definition);
    this.assertWriteAllowed(definition, options.scope, options.sourceSystem);
    this.clearFactInternal(definition.key, options.scope, "explicit-clear");
  }

  listFacts(scope: BlackboardScopeRef): BlackboardFactEnvelope<unknown>[] {
    const serializedScope = serializeScope(scope);
    return Array.from(this.facts.values()).filter(
      (fact) => serializeScope(fact.scope) === serializedScope
    );
  }

  clearSessionFacts(): void {
    for (const definition of this.definitions.values()) {
      if (definition.lifecycle.kind !== "session") {
        continue;
      }

      for (const fact of this.facts.values()) {
        if (fact.key !== definition.key) {
          continue;
        }
        this.clearFactInternal(definition.key, fact.scope, "session-clear");
      }
    }
  }

  advanceFrame(): void {
    for (const definition of this.definitions.values()) {
      if (definition.lifecycle.kind !== "frame") {
        continue;
      }

      for (const fact of this.facts.values()) {
        if (fact.key !== definition.key) {
          continue;
        }
        this.clearFactInternal(definition.key, fact.scope, "frame-advance");
      }
    }
  }

  private scheduleExpiryIfNeeded<TValue>(
    definition: BlackboardFactDefinition<TValue>,
    storageKey: string,
    envelope: BlackboardFactEnvelope<TValue>
  ): void {
    if (definition.lifecycle.kind !== "ephemeral") {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      const current = this.facts.get(storageKey);
      if (!current) {
        return;
      }
      this.clearExpiryTimer(storageKey);
      this.facts.delete(storageKey);
      this.emit({
        type: "expire",
        key: envelope.key,
        scope: envelope.scope,
        reason: "ephemeral-expiry",
        current: null,
        previous: current
      });
    }, definition.lifecycle.expiresAfterMs);

    this.expiryTimers.set(storageKey, timer);
  }

  private clearFactInternal(
    key: string,
    scope: BlackboardScopeRef,
    reason: Exclude<BlackboardChangeReason, "explicit-set">
  ): void {
    const storageKey = serializeFactStorageKey(key, scope);
    const previous = this.facts.get(storageKey) ?? null;
    if (!previous) {
      return;
    }

    this.clearExpiryTimer(storageKey);
    this.facts.delete(storageKey);
    this.emit({
      type: reason === "ephemeral-expiry" ? "expire" : "clear",
      key,
      scope,
      reason,
      current: null,
      previous
    });
  }

  private clearExpiryTimer(storageKey: string): void {
    const timer = this.expiryTimers.get(storageKey);
    if (!timer) {
      return;
    }
    globalThis.clearTimeout(timer);
    this.expiryTimers.delete(storageKey);
  }

  private emit(event: BlackboardChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private requireDefinition<TValue>(
    definition: BlackboardFactDefinition<TValue>
  ): BlackboardFactDefinition<TValue> {
    const resolvedDefinition = this.definitions.get(definition.key);
    if (!resolvedDefinition) {
      throw new Error(`Unknown blackboard fact definition for key "${definition.key}".`);
    }
    return resolvedDefinition as BlackboardFactDefinition<TValue>;
  }

  private assertWriteAllowed<TValue>(
    definition: BlackboardFactDefinition<TValue>,
    scope: BlackboardScopeRef,
    sourceSystem: string
  ): void {
    if (definition.ownerSystem !== sourceSystem) {
      throw new Error(
        `Blackboard fact "${definition.key}" is owned by "${definition.ownerSystem}", not "${sourceSystem}".`
      );
    }

    if (!definition.allowedScopeKinds.includes(scope.kind)) {
      throw new Error(
        `Blackboard fact "${definition.key}" cannot be written to scope kind "${scope.kind}".`
      );
    }
  }
}

export function createRuntimeBlackboard(
  options: RuntimeBlackboardOptions = {}
): RuntimeBlackboard {
  return new RuntimeBlackboard(options);
}

export function getEntityPosition(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityPositionFact | null {
  return (
    blackboard.getFact(ENTITY_POSITION_FACT, createBlackboardScope("entity", entityId))?.value ??
    null
  );
}

export function setEntityPosition(
  blackboard: RuntimeBlackboard,
  value: EntityPositionFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityPositionFact> {
  return blackboard.setFact({
    definition: ENTITY_POSITION_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_POSITION_FACT.ownerSystem
  });
}

export function getEntityLocation(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityLocationFact | null {
  return (
    blackboard.getFact(ENTITY_LOCATION_FACT, createBlackboardScope("entity", entityId))?.value ??
    null
  );
}

export function getEntityCurrentArea(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityCurrentAreaFact | null {
  return (
    blackboard.getFact(ENTITY_CURRENT_AREA_FACT, createBlackboardScope("entity", entityId))
      ?.value ?? null
  );
}

export function setEntityCurrentArea(
  blackboard: RuntimeBlackboard,
  value: EntityCurrentAreaFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityCurrentAreaFact> {
  return blackboard.setFact({
    definition: ENTITY_CURRENT_AREA_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_CURRENT_AREA_FACT.ownerSystem
  });
}

export function getEntityPlayerSpatialRelation(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityPlayerSpatialRelationFact | null {
  return (
    blackboard.getFact(
      ENTITY_PLAYER_SPATIAL_RELATION_FACT,
      createBlackboardScope("entity", entityId)
    )?.value ?? null
  );
}

export function setEntityPlayerSpatialRelation(
  blackboard: RuntimeBlackboard,
  value: EntityPlayerSpatialRelationFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityPlayerSpatialRelationFact> {
  return blackboard.setFact({
    definition: ENTITY_PLAYER_SPATIAL_RELATION_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_PLAYER_SPATIAL_RELATION_FACT.ownerSystem
  });
}

export function setEntityLocation(
  blackboard: RuntimeBlackboard,
  value: EntityLocationFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityLocationFact> {
  return blackboard.setFact({
    definition: ENTITY_LOCATION_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_LOCATION_FACT.ownerSystem
  });
}

export function getEntityMovement(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityMovementFact | null {
  return (
    blackboard.getFact(ENTITY_MOVEMENT_FACT, createBlackboardScope("entity", entityId))
      ?.value ?? null
  );
}

export function setEntityMovement(
  blackboard: RuntimeBlackboard,
  value: EntityMovementFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityMovementFact> {
  return blackboard.setFact({
    definition: ENTITY_MOVEMENT_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_MOVEMENT_FACT.ownerSystem
  });
}

export function getEntityCurrentActivity(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityCurrentActivityFact | null {
  return (
    blackboard.getFact(
      ENTITY_CURRENT_ACTIVITY_FACT,
      createBlackboardScope("entity", entityId)
    )?.value ?? null
  );
}

export function setEntityCurrentActivity(
  blackboard: RuntimeBlackboard,
  value: EntityCurrentActivityFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityCurrentActivityFact> {
  return blackboard.setFact({
    definition: ENTITY_CURRENT_ACTIVITY_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_CURRENT_ACTIVITY_FACT.ownerSystem
  });
}

export function getEntityCurrentGoal(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityCurrentGoalFact | null {
  return (
    blackboard.getFact(ENTITY_CURRENT_GOAL_FACT, createBlackboardScope("entity", entityId))
      ?.value ?? null
  );
}

export function setEntityCurrentGoal(
  blackboard: RuntimeBlackboard,
  value: EntityCurrentGoalFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityCurrentGoalFact> {
  return blackboard.setFact({
    definition: ENTITY_CURRENT_GOAL_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_CURRENT_GOAL_FACT.ownerSystem
  });
}

export function getTrackedQuest(
  blackboard: RuntimeBlackboard
): TrackedQuestFact | null {
  return (
    blackboard.getFact(TRACKED_QUEST_FACT, createBlackboardScope("global", "tracked-quest"))
      ?.value ?? null
  );
}

export function setTrackedQuest(
  blackboard: RuntimeBlackboard,
  value: TrackedQuestFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<TrackedQuestFact> {
  return blackboard.setFact({
    definition: TRACKED_QUEST_FACT,
    scope: createBlackboardScope("global", "tracked-quest"),
    value,
    sourceSystem: options.sourceSystem ?? TRACKED_QUEST_FACT.ownerSystem
  });
}

export function clearTrackedQuest(
  blackboard: RuntimeBlackboard,
  options: { sourceSystem?: string } = {}
): void {
  blackboard.clearFact({
    definition: TRACKED_QUEST_FACT,
    scope: createBlackboardScope("global", "tracked-quest"),
    sourceSystem: options.sourceSystem ?? TRACKED_QUEST_FACT.ownerSystem
  });
}

export function getActiveQuestStage(
  blackboard: RuntimeBlackboard,
  questId: string
): QuestActiveStageFact | null {
  return (
    blackboard.getFact(QUEST_ACTIVE_STAGE_FACT, createBlackboardScope("quest", questId))?.value ??
    null
  );
}

export function setActiveQuestStage(
  blackboard: RuntimeBlackboard,
  value: QuestActiveStageFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<QuestActiveStageFact> {
  return blackboard.setFact({
    definition: QUEST_ACTIVE_STAGE_FACT,
    scope: createBlackboardScope("quest", value.questId),
    value,
    sourceSystem: options.sourceSystem ?? QUEST_ACTIVE_STAGE_FACT.ownerSystem
  });
}

export function clearActiveQuestStage(
  blackboard: RuntimeBlackboard,
  questId: string,
  options: { sourceSystem?: string } = {}
): void {
  blackboard.clearFact({
    definition: QUEST_ACTIVE_STAGE_FACT,
    scope: createBlackboardScope("quest", questId),
    sourceSystem: options.sourceSystem ?? QUEST_ACTIVE_STAGE_FACT.ownerSystem
  });
}

export function getActiveQuestObjectives(
  blackboard: RuntimeBlackboard,
  questId: string
): QuestActiveObjectivesFact | null {
  return (
    blackboard.getFact(QUEST_ACTIVE_OBJECTIVES_FACT, createBlackboardScope("quest", questId))
      ?.value ?? null
  );
}

export function setActiveQuestObjectives(
  blackboard: RuntimeBlackboard,
  value: QuestActiveObjectivesFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<QuestActiveObjectivesFact> {
  return blackboard.setFact({
    definition: QUEST_ACTIVE_OBJECTIVES_FACT,
    scope: createBlackboardScope("quest", value.questId),
    value,
    sourceSystem: options.sourceSystem ?? QUEST_ACTIVE_OBJECTIVES_FACT.ownerSystem
  });
}

export function clearActiveQuestObjectives(
  blackboard: RuntimeBlackboard,
  questId: string,
  options: { sourceSystem?: string } = {}
): void {
  blackboard.clearFact({
    definition: QUEST_ACTIVE_OBJECTIVES_FACT,
    scope: createBlackboardScope("quest", questId),
    sourceSystem: options.sourceSystem ?? QUEST_ACTIVE_OBJECTIVES_FACT.ownerSystem
  });
}

export function createBlackboardScope(
  kind: BlackboardScopeKind,
  id: string
): BlackboardScopeRef {
  return { kind, id };
}

// Plan 077 §077.3a -- world-narrative fact helpers (narrative-system owned).

export function getGoalSurfacedCount(
  blackboard: RuntimeBlackboard,
  questId: string
): number {
  return (
    blackboard.getFact(
      GOAL_SURFACED_COUNT_FACT,
      createBlackboardScope("quest", questId)
    )?.value ?? 0
  );
}

export function bumpGoalSurfacedCount(
  blackboard: RuntimeBlackboard,
  questId: string
): void {
  const current = getGoalSurfacedCount(blackboard, questId);
  blackboard.setFact({
    definition: GOAL_SURFACED_COUNT_FACT,
    scope: createBlackboardScope("quest", questId),
    value: current + 1,
    sourceSystem: NARRATIVE_SOURCE_SYSTEM
  });
}

// Plan 074 §074.2' -- world clock getters/setters.

export function getTimeOfDayBand(blackboard: RuntimeBlackboard): TimeOfDayBand {
  return (
    blackboard.getFact(
      WORLD_TIME_OF_DAY_FACT,
      createBlackboardScope("global", "world.time-of-day")
    )?.value ?? "morning"
  );
}

export function getWorldDay(blackboard: RuntimeBlackboard): number {
  return (
    blackboard.getFact(
      WORLD_DAY_FACT,
      createBlackboardScope("global", "world.day")
    )?.value ?? 1
  );
}

export function setWorldTimeOfDay(
  blackboard: RuntimeBlackboard,
  band: TimeOfDayBand
): void {
  blackboard.setFact({
    definition: WORLD_TIME_OF_DAY_FACT,
    scope: createBlackboardScope("global", "world.time-of-day"),
    value: band,
    sourceSystem: WORLD_TIME_SOURCE_SYSTEM
  });
}

export function setWorldDay(blackboard: RuntimeBlackboard, day: number): void {
  blackboard.setFact({
    definition: WORLD_DAY_FACT,
    scope: createBlackboardScope("global", "world.day"),
    value: day,
    sourceSystem: WORLD_TIME_SOURCE_SYSTEM
  });
}

// Plan 074 §074.5 -- player-known-facts getters/setters.

export function getPlayerKnownFacts(blackboard: RuntimeBlackboard): string[] {
  return (
    blackboard.getFact(
      PLAYER_KNOWN_FACTS_FACT,
      createBlackboardScope("global", "player.known-facts")
    )?.value ?? []
  );
}

export function setPlayerKnownFacts(
  blackboard: RuntimeBlackboard,
  facts: string[]
): void {
  blackboard.setFact({
    definition: PLAYER_KNOWN_FACTS_FACT,
    scope: createBlackboardScope("global", "player.known-facts"),
    value: facts,
    sourceSystem: PLAYER_FACTS_SOURCE_SYSTEM
  });
}

function serializeFactStorageKey(key: string, scope: BlackboardScopeRef): string {
  return `${key}@@${serializeScope(scope)}`;
}

function serializeScope(scope: BlackboardScopeRef): string {
  return `${scope.kind}:${scope.id}`;
}
