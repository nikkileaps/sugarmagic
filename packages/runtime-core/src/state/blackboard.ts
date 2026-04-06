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

export interface LocationReference {
  regionId: string | null;
  regionDisplayName: string | null;
  regionLorePageId: string | null;
  sceneId: string | null;
  sceneDisplayName: string | null;
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

export type EntityMood =
  | "neutral"
  | "friendly"
  | "hostile"
  | "anxious"
  | "relieved";

export type EntityUrgency = "calm" | "alert" | "urgent" | "critical";

export type EntityStance =
  | "open"
  | "guarded"
  | "defensive"
  | "aggressive";

export interface EntityAffectFact {
  entityId: string;
  mood: EntityMood | null;
  urgency: EntityUrgency | null;
  stance: EntityStance | null;
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

export const ENTITY_AFFECT_FACT = defineBlackboardFact<EntityAffectFact>({
  key: "entity.affect",
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

export const RUNTIME_BLACKBOARD_FACT_DEFINITIONS = [
  ENTITY_POSITION_FACT,
  ENTITY_LOCATION_FACT,
  ENTITY_AFFECT_FACT,
  TRACKED_QUEST_FACT,
  QUEST_ACTIVE_STAGE_FACT,
  QUEST_ACTIVE_OBJECTIVES_FACT
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

export function getEntityAffect(
  blackboard: RuntimeBlackboard,
  entityId: string
): EntityAffectFact | null {
  return (
    blackboard.getFact(ENTITY_AFFECT_FACT, createBlackboardScope("entity", entityId))?.value ??
    null
  );
}

export function setEntityAffect(
  blackboard: RuntimeBlackboard,
  value: EntityAffectFact,
  options: { sourceSystem?: string } = {}
): BlackboardFactEnvelope<EntityAffectFact> {
  return blackboard.setFact({
    definition: ENTITY_AFFECT_FACT,
    scope: createBlackboardScope("entity", value.entityId),
    value,
    sourceSystem: options.sourceSystem ?? ENTITY_AFFECT_FACT.ownerSystem
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

function serializeFactStorageKey(key: string, scope: BlackboardScopeRef): string {
  return `${key}@@${serializeScope(scope)}`;
}

function serializeScope(scope: BlackboardScopeRef): string {
  return `${scope.kind}:${scope.id}`;
}
