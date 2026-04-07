import type {
  RegionDocument,
  RegionBehaviorWorldFlagCondition,
  RegionNPCBehaviorDefinition,
  RegionNPCBehaviorTask
} from "@sugarmagic/domain";
import { Position, type Entity, type World } from "../ecs";
import {
  setEntityCurrentActivity,
  setEntityCurrentGoal,
  setEntityMovement,
  type RuntimeBlackboard
} from "../state";
import { findRegionAreaById } from "../spatial";

export interface RuntimeBehaviorQuestState {
  questDefinitionId: string;
  stageId: string | null;
}

export interface RuntimeBehaviorNpcEntityRef {
  presenceId: string;
  npcDefinitionId: string;
  entity: Entity;
}

export interface RuntimeNpcBehaviorSystemOptions {
  region: RegionDocument;
  world: World;
  blackboard: RuntimeBlackboard;
  npcEntities?: RuntimeBehaviorNpcEntityRef[];
  getNpcEntities?: () => RuntimeBehaviorNpcEntityRef[];
  hasWorldFlag?: (key: string, value?: unknown) => boolean;
  movementSpeedMetersPerSecond?: number;
  stuckTimeoutMs?: number;
  arrivalThresholdMeters?: number;
  now?: () => number;
  logDebug?: (event: string, payload?: Record<string, unknown>) => void;
}

export interface RuntimeNpcBehaviorSyncResult {
  snapshots: Array<{
    presenceId: string;
    npcDefinitionId: string;
    x: number;
    y: number;
    z: number;
  }>;
}

export interface RuntimeNpcCurrentTask {
  npcDefinitionId: string;
  taskId: string | null;
  displayName: string | null;
  description: string | null;
}

export interface RuntimeNpcBehaviorSystem {
  sync: (input: {
    deltaSeconds: number;
    activeQuest: RuntimeBehaviorQuestState | null;
  }) => RuntimeNpcBehaviorSyncResult;
  getCurrentTask: (npcDefinitionId: string) => RuntimeNpcCurrentTask | null;
  reset: () => void;
}

interface MovementState {
  targetAreaId: string | null;
  targetTaskId: string | null;
  targetX: number | null;
  targetZ: number | null;
  lastX: number;
  lastZ: number;
  lastProgressAtMs: number;
  blockedAtMs: number | null;
  status: "idle" | "en_route" | "at_target" | "blocked";
}

interface MovementDirective {
  targetAreaId: string | null;
  targetAreaDisplayName: string | null;
  targetTaskId: string | null;
  targetTaskDisplayName: string | null;
  targetX: number | null;
  targetZ: number | null;
}

// V1 locomotion defaults are intentionally conservative:
// - movement speed should read as a relaxed walk in the preview without making
//   short station-area traversals feel sluggish
// - stuck timeout should allow brief obstruction/jitter before we call the NPC blocked
// - arrival threshold should be wide enough to avoid oscillating around the sampled point
//   while still looking like the NPC reached the authored destination
const DEFAULT_MOVEMENT_SPEED_METERS_PER_SECOND = 2.5;
const DEFAULT_STUCK_TIMEOUT_MS = 2500;
const DEFAULT_ARRIVAL_THRESHOLD_METERS = 0.4;
const MOVEMENT_PROGRESS_THRESHOLD_METERS = 0.05;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleNormalizedOffset(hash: number): number {
  return ((hash % 1000) / 999) * 2 - 1;
}

function resolveTaskTargetPoint(
  area: RegionDocument["areas"][number],
  npcDefinitionId: string,
  taskId: string | null,
  arrivalThresholdMeters: number
): { x: number; z: number } {
  const centerX = area.bounds.center[0];
  const centerZ = area.bounds.center[2];
  const halfSizeX = area.bounds.size[0] / 2;
  const halfSizeZ = area.bounds.size[2] / 2;
  const padding = Math.min(
    Math.max(arrivalThresholdMeters, 0.25),
    Math.max(Math.min(halfSizeX, halfSizeZ) - 0.1, 0)
  );
  const maxOffsetX = Math.max(halfSizeX - padding, 0);
  const maxOffsetZ = Math.max(halfSizeZ - padding, 0);

  if (maxOffsetX === 0 && maxOffsetZ === 0) {
    return { x: centerX, z: centerZ };
  }

  const seed = `${npcDefinitionId}:${taskId ?? "no-task"}:${area.areaId}`;
  const hashX = hashString(`${seed}:x`);
  const hashZ = hashString(`${seed}:z`);
  return {
    x: centerX + sampleNormalizedOffset(hashX) * maxOffsetX,
    z: centerZ + sampleNormalizedOffset(hashZ) * maxOffsetZ
  };
}

function coerceWorldFlagValue(
  condition: RegionBehaviorWorldFlagCondition
): string | boolean | number | undefined {
  if (condition.valueType === "boolean") {
    if (condition.value === null) {
      return true;
    }
    return condition.value.toLowerCase() === "true";
  }
  if (condition.valueType === "number") {
    if (condition.value === null) {
      return undefined;
    }
    const parsed = Number(condition.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return condition.value ?? undefined;
}

function taskMatchesActivation(
  task: RegionNPCBehaviorTask,
  activeQuest: RuntimeBehaviorQuestState | null,
  hasWorldFlag?: (key: string, value?: unknown) => boolean
): boolean {
  if (task.activation.questDefinitionId && activeQuest?.questDefinitionId !== task.activation.questDefinitionId) {
    return false;
  }
  if (task.activation.questStageId && activeQuest?.stageId !== task.activation.questStageId) {
    return false;
  }
  if (task.activation.worldFlagEquals?.key) {
    if (!hasWorldFlag) {
      return false;
    }
    const expectedValue = coerceWorldFlagValue(task.activation.worldFlagEquals);
    if (!hasWorldFlag(task.activation.worldFlagEquals.key, expectedValue)) {
      return false;
    }
  }
  return true;
}

function resolveBehaviorTask(
  behavior: RegionNPCBehaviorDefinition | null,
  activeQuest: RuntimeBehaviorQuestState | null,
  hasWorldFlag?: (key: string, value?: unknown) => boolean
): RegionNPCBehaviorTask | null {
  if (!behavior || behavior.tasks.length === 0) {
    return null;
  }

  const questMatchedTask =
    behavior.tasks.find((task) => taskMatchesActivation(task, activeQuest, hasWorldFlag)) ?? null;
  if (questMatchedTask) {
    return questMatchedTask;
  }

  return (
    behavior.tasks.find(
      (task) =>
        task.activation.questDefinitionId === null &&
        task.activation.questStageId === null &&
        task.activation.worldFlagEquals === null
    ) ?? null
  );
}

function distance2d(
  left: { x: number; z: number },
  right: { x: number; z: number }
): number {
  const dx = left.x - right.x;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function createInitialMovementState(
  position: { x: number; z: number },
  nowMs: number
): MovementState {
  return {
    targetAreaId: null,
    targetTaskId: null,
    targetX: null,
    targetZ: null,
    lastX: position.x,
    lastZ: position.z,
    lastProgressAtMs: nowMs,
    blockedAtMs: null,
    status: "idle"
  };
}

function resolveDirectiveChange(input: {
  state: MovementState;
  position: { x: number; z: number };
  directive: MovementDirective;
  nowMs: number;
}): { nextState: MovementState; changed: boolean } {
  const { state, position, directive, nowMs } = input;
  const changed =
    state.targetAreaId !== directive.targetAreaId ||
    state.targetTaskId !== directive.targetTaskId;

  if (!changed) {
    return { nextState: state, changed: false };
  }

  return {
    changed: true,
    nextState: {
      ...state,
      targetAreaId: directive.targetAreaId,
      targetTaskId: directive.targetTaskId,
      targetX: directive.targetX,
      targetZ: directive.targetZ,
      lastX: position.x,
      lastZ: position.z,
      lastProgressAtMs: nowMs,
      blockedAtMs: null
    }
  };
}

function stepToward(input: {
  position: { x: number; z: number };
  target: { x: number; z: number };
  movementSpeedMetersPerSecond: number;
  deltaSeconds: number;
  arrivalThresholdMeters: number;
}):
  | { status: "at_target"; x: number; z: number; distanceToTargetMeters: number }
  | { status: "en_route"; x: number; z: number; distanceToTargetMeters: number } {
  const distanceToTargetMeters = distance2d(input.position, input.target);
  if (distanceToTargetMeters <= input.arrivalThresholdMeters) {
    return {
      status: "at_target",
      x: input.target.x,
      z: input.target.z,
      distanceToTargetMeters
    };
  }

  const maxStep =
    input.movementSpeedMetersPerSecond * Math.max(input.deltaSeconds, 0);
  const dx = input.target.x - input.position.x;
  const dz = input.target.z - input.position.z;
  const distance = Math.max(distanceToTargetMeters, 0.0001);
  const step = Math.min(distance, maxStep);
  return {
    status: "en_route",
    x: input.position.x + (dx / distance) * step,
    z: input.position.z + (dz / distance) * step,
    distanceToTargetMeters
  };
}

function detectStuck(input: {
  position: { x: number; z: number };
  lastProgressPosition: { x: number; z: number };
  lastProgressAtMs: number;
  nowMs: number;
  stuckTimeoutMs: number;
}): { madeProgress: boolean; progressDistance: number; isStuck: boolean } {
  const progressDistance = distance2d(input.position, input.lastProgressPosition);
  const madeProgress = progressDistance >= MOVEMENT_PROGRESS_THRESHOLD_METERS;
  return {
    madeProgress,
    progressDistance,
    isStuck: !madeProgress && input.nowMs - input.lastProgressAtMs >= input.stuckTimeoutMs
  };
}

export function createRuntimeNpcBehaviorSystem(
  options: RuntimeNpcBehaviorSystemOptions
): RuntimeNpcBehaviorSystem {
  const {
    region,
    world,
    blackboard,
    npcEntities,
    getNpcEntities,
    hasWorldFlag,
    movementSpeedMetersPerSecond = DEFAULT_MOVEMENT_SPEED_METERS_PER_SECOND,
    stuckTimeoutMs = DEFAULT_STUCK_TIMEOUT_MS,
    arrivalThresholdMeters = DEFAULT_ARRIVAL_THRESHOLD_METERS,
    now = () => Date.now(),
    logDebug
  } = options;
  const movementStateByNpcId = new Map<string, MovementState>();
  const currentTaskByNpcId = new Map<string, RuntimeNpcCurrentTask>();
  const behaviorByNpcId = new Map(
    region.behaviors.map((behavior) => [behavior.npcDefinitionId, behavior])
  );

  function emitDebug(event: string, payload?: Record<string, unknown>) {
    logDebug?.(event, payload);
  }

  function resolveNpcEntities(): RuntimeBehaviorNpcEntityRef[] {
    return getNpcEntities?.() ?? npcEntities ?? [];
  }

  function syncNpc(
    npc: RuntimeBehaviorNpcEntityRef,
    deltaSeconds: number,
    activeQuest: RuntimeBehaviorQuestState | null
  ) {
    const position = world.getComponent(npc.entity, Position);
    if (!position) {
      return null;
    }

    const behavior = behaviorByNpcId.get(npc.npcDefinitionId) ?? null;
    const task = resolveBehaviorTask(behavior, activeQuest, hasWorldFlag);
    const targetArea = task ? findRegionAreaById(region, task.targetAreaId) : null;
    const directiveTargetPoint = targetArea
      ? resolveTaskTargetPoint(
          targetArea,
          npc.npcDefinitionId,
          task?.taskId ?? null,
          arrivalThresholdMeters
        )
      : null;
    const directive: MovementDirective = {
      targetAreaId: targetArea?.areaId ?? null,
      targetAreaDisplayName: targetArea?.displayName ?? null,
      targetTaskId: task?.taskId ?? null,
      targetTaskDisplayName: task?.displayName ?? null,
      targetX: directiveTargetPoint?.x ?? null,
      targetZ: directiveTargetPoint?.z ?? null
    };
    let state =
      movementStateByNpcId.get(npc.npcDefinitionId) ??
      createInitialMovementState(position, now());

    const directiveResult = resolveDirectiveChange({
      state,
      position,
      directive,
      nowMs: now()
    });
    state = directiveResult.nextState;

    if (directiveResult.changed) {
      emitDebug("npc-movement-directive-changed", {
        npcDefinitionId: npc.npcDefinitionId,
        targetAreaId: directive.targetAreaId,
        targetAreaDisplayName: directive.targetAreaDisplayName,
        taskId: directive.targetTaskId,
        taskDisplayName: directive.targetTaskDisplayName
      });
    }

    let distanceToTargetMeters: number | null = null;
    let failureReason: "stuck" | "missing-target-area" | null = null;

    if (!task || !targetArea) {
      state.status =
        task?.targetAreaId && !targetArea ? "blocked" : "idle";
      state.blockedAtMs = task?.targetAreaId && !targetArea ? now() : null;
      failureReason = task?.targetAreaId && !targetArea ? "missing-target-area" : null;
    } else {
      const targetX = state.targetX ?? targetArea.bounds.center[0];
      const targetZ = state.targetZ ?? targetArea.bounds.center[2];
      const targetPoint = { x: targetX, z: targetZ };

      const movedSinceLastProgress =
        distance2d(position, {
          x: state.lastX,
          z: state.lastZ
        }) >= MOVEMENT_PROGRESS_THRESHOLD_METERS;

      if (state.status === "blocked" && movedSinceLastProgress) {
        state.lastX = position.x;
        state.lastZ = position.z;
        state.lastProgressAtMs = now();
        state.blockedAtMs = null;
        state.status = "idle";
        emitDebug("npc-movement-unblocked", {
          npcDefinitionId: npc.npcDefinitionId,
          targetAreaId: directive.targetAreaId,
          targetAreaDisplayName: directive.targetAreaDisplayName,
          reason: "external-progress"
        });
      }

      if (
        state.status === "blocked" &&
        state.blockedAtMs !== null &&
        now() - state.blockedAtMs >= stuckTimeoutMs
      ) {
        state.status = "idle";
        state.blockedAtMs = null;
        state.lastX = position.x;
        state.lastZ = position.z;
        state.lastProgressAtMs = now();
        emitDebug("npc-movement-retrying", {
          npcDefinitionId: npc.npcDefinitionId,
          targetAreaId: directive.targetAreaId,
          targetAreaDisplayName: directive.targetAreaDisplayName,
          taskId: task.taskId,
          taskDisplayName: task.displayName
        });
      }

      const stepResult = stepToward({
        position,
        target: targetPoint,
        movementSpeedMetersPerSecond,
        deltaSeconds,
        arrivalThresholdMeters
      });
      distanceToTargetMeters = stepResult.distanceToTargetMeters;

      if (stepResult.status === "at_target") {
        // V1 movement is position-based and writes directly to the Position component.
        // That keeps NPC behavior deterministic, but it also means this path does not
        // emit a separate "moved" event for other ECS systems and only resolves planar
        // x/z travel toward a sampled point inside the authored area. Vertical traversal
        // and richer movement signaling belong in a later locomotion/pathfinding layer.
        position.x = stepResult.x;
        position.z = stepResult.z;
        state.status = "at_target";
        state.lastProgressAtMs = now();
        state.blockedAtMs = null;
      } else if (state.status !== "blocked") {
        // See note above: this mutates Position in place for V1 behavior movement.
        position.x = stepResult.x;
        position.z = stepResult.z;
        state.status = "en_route";

        const stuckResult = detectStuck({
          position,
          lastProgressPosition: {
            x: state.lastX,
            z: state.lastZ
          },
          lastProgressAtMs: state.lastProgressAtMs,
          nowMs: now(),
          stuckTimeoutMs
        });
        if (stuckResult.madeProgress) {
          state.lastX = position.x;
          state.lastZ = position.z;
          state.lastProgressAtMs = now();
          state.blockedAtMs = null;
        } else if (stuckResult.isStuck) {
          state.status = "blocked";
          state.blockedAtMs = now();
          failureReason = "stuck";
          emitDebug("npc-movement-blocked", {
            npcDefinitionId: npc.npcDefinitionId,
            targetAreaId: directive.targetAreaId,
            targetAreaDisplayName: directive.targetAreaDisplayName
          });
        }
      } else {
        failureReason = "stuck";
      }
    }

    movementStateByNpcId.set(npc.npcDefinitionId, state);
    currentTaskByNpcId.set(npc.npcDefinitionId, {
      npcDefinitionId: npc.npcDefinitionId,
      taskId: task?.taskId ?? null,
      displayName: task?.displayName ?? null,
      description: task?.description ?? null
    });

    setEntityMovement(blackboard, {
      entityId: npc.npcDefinitionId,
      targetAreaId: directive.targetAreaId,
      targetAreaDisplayName: directive.targetAreaDisplayName,
      status: state.status,
      distanceToTargetMeters,
      failureReason
    });
    setEntityCurrentActivity(blackboard, {
      entityId: npc.npcDefinitionId,
      activity: task?.currentActivity ?? "idle"
    });
    setEntityCurrentGoal(blackboard, {
      entityId: npc.npcDefinitionId,
      goal: task?.currentGoal ?? "idle"
    });

    return {
      presenceId: npc.presenceId,
      npcDefinitionId: npc.npcDefinitionId,
      x: position.x,
      y: position.y,
      z: position.z
    };
  }

  return {
    sync(input) {
      const currentNpcEntities = resolveNpcEntities();
      const activeNpcIds = new Set(
        currentNpcEntities.map((npc) => npc.npcDefinitionId)
      );
      for (const npcDefinitionId of movementStateByNpcId.keys()) {
        if (activeNpcIds.has(npcDefinitionId)) {
          continue;
        }
        movementStateByNpcId.delete(npcDefinitionId);
        currentTaskByNpcId.delete(npcDefinitionId);
      }

      const snapshots = currentNpcEntities
        .map((npc) => syncNpc(npc, input.deltaSeconds, input.activeQuest))
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null);

      return { snapshots };
    },
    getCurrentTask(npcDefinitionId) {
      return currentTaskByNpcId.get(npcDefinitionId) ?? null;
    },
    reset() {
      movementStateByNpcId.clear();
      currentTaskByNpcId.clear();
    }
  };
}
