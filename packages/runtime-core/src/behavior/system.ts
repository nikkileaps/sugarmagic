import type {
  RegionDocument,
  RegionNPCBehaviorDefinition,
  RegionNPCBehaviorTask,
  SaveSlice
} from "@sugarmagic/domain";
import { Position, type Entity, type World } from "../ecs";
import {
  setEntityCurrentActivity,
  setEntityCurrentGoal,
  setEntityMovement,
  type RuntimeBlackboard
} from "../state";
import { findRegionAreaById } from "../spatial";
import {
  resolveMove,
  type CircleObstacle,
  type CollisionWorld
} from "../collision";
import { evaluateRegionQuestBinding } from "../region-conditions";
import type { NavMeshPathfinder } from "../navmesh";

/** One dynamic agent (NPC/player) the NPC mover must not interpenetrate
 *  (Plan 069.3). `id` is the presenceId, used to exclude self. */
export interface NpcCollisionAgent {
  id: string;
  x: number;
  z: number;
  radius: number;
}

/** Per-frame collision context for NPC movement (Plan 069.3): the static
 *  collision world + every agent circle (built by the caller). */
export interface NpcMovementCollisionContext {
  world: CollisionWorld;
  agents: readonly NpcCollisionAgent[];
}

/** Fallback NPC radius when an NPC is absent from the agent snapshot. */
const DEFAULT_NPC_AGENT_RADIUS = 0.35;

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
  /** Plan 069.3 — supplies the collision world + agent circles each sync
   *  so NPC moves route through the SAME `resolveMove` as the player
   *  (single enforcer). Absent => NPCs move without collision (V1 / tests). */
  getCollisionContext?: () => NpcMovementCollisionContext | null;
  /** Plan 069.9 — the baked navmesh pathfinder. When present, NPCs follow
   *  navmesh waypoints to the task target (routing around props); absent =>
   *  straight-line locomotion (069.3), so unbaked regions keep working. */
  getPathfinder?: () => NavMeshPathfinder | null;
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
  serializeSaveSlice: () => NpcBehaviorSlice;
  deserializeSaveSlice: (slice: NpcBehaviorSaveSlice | null) => void;
}

/**
 * Plan 056 §056.2 — persisted per-NPC state. Keyed by
 * `npcDefinitionId` to match the internal `movementStateByNpcId`
 * keying. Wall-clock timestamps (`lastProgressAtMs`,
 * `blockedAtMs`) and sampled waypoints (`targetX/Z`) are
 * explicitly OMITTED from the wire — timestamps would look
 * "stuck for hours" on reload; waypoints get re-sampled inside
 * the target area on next tick with no visible difference.
 */
export interface NpcBehaviorSlice {
  npcs: Record<
    string,
    {
      position: { x: number; y: number; z: number };
      target: { areaId: string | null; taskId: string | null } | null;
      status: "idle" | "en_route" | "at_target" | "blocked";
    }
  >;
}

/** Envelope alias matching the other participants' shapes. */
export type NpcBehaviorSaveSlice = SaveSlice<NpcBehaviorSlice>;

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
// Plan 069.9 — path-following tuning.
const WAYPOINT_ARRIVAL_METERS = 0.6; // advance to the next corner within this
const REPATH_TARGET_MOVE_METERS = 1.0; // re-path when the final target shifts
const REPATH_DRIFT_METERS = 2.5; // re-path when collision shoved us off route

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

function taskMatchesActivation(
  task: RegionNPCBehaviorTask,
  activeQuest: RuntimeBehaviorQuestState | null,
  hasWorldFlag?: (key: string, value?: unknown) => boolean
): boolean {
  // Plan 069.5 — one grammar evaluator, shared with the containment gate.
  return evaluateRegionQuestBinding(task.activation, {
    activeQuest,
    hasWorldFlag
  });
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
    logDebug,
    getCollisionContext,
    getPathfinder
  } = options;
  const movementStateByNpcId = new Map<string, MovementState>();
  // Plan 069.9 — ephemeral (not persisted) navmesh route per NPC: the
  // waypoint list + which one we're heading to + the final target it was
  // computed for (to detect a target change and re-path).
  const navPathByNpcId = new Map<
    string,
    { waypoints: { x: number; z: number }[]; index: number; targetX: number; targetZ: number }
  >();
  const currentTaskByNpcId = new Map<string, RuntimeNpcCurrentTask>();
  const behaviorByNpcId = new Map(
    region.behaviors.map((behavior) => [behavior.npcDefinitionId, behavior])
  );
  // Plan 069.3 — snapshotted once per sync so every NPC this frame resolves
  // against the same agent positions (last-frame snapshot, standard).
  let currentCollisionContext: NpcMovementCollisionContext | null = null;
  const otherAgentCircles: CircleObstacle[] = [];

  /**
   * Plan 069.9 — the immediate step target: the current navmesh waypoint
   * toward `finalTarget`, or `finalTarget` itself when there is no pathfinder
   * or no route (straight-line fallback — unbaked regions keep working). Re-
   * paths when the target shifts, the route is exhausted, or collision shoved
   * the NPC off it. The stepper still measures ARRIVAL against `finalTarget`.
   */
  function resolveStepTarget(
    npcId: string,
    position: { x: number; y: number; z: number },
    finalTarget: { x: number; z: number }
  ): { x: number; z: number } {
    const pathfinder = getPathfinder?.() ?? null;
    if (!pathfinder) {
      navPathByNpcId.delete(npcId);
      return finalTarget;
    }
    let path = navPathByNpcId.get(npcId);
    const targetMoved =
      !!path &&
      distance2d({ x: path.targetX, z: path.targetZ }, finalTarget) >
        REPATH_TARGET_MOVE_METERS;
    const currentWaypoint = path?.waypoints[path.index] ?? null;
    const drifted =
      !!currentWaypoint &&
      distance2d(position, currentWaypoint) > REPATH_DRIFT_METERS;
    const exhausted = !!path && path.index >= path.waypoints.length;

    if (!path || targetMoved || drifted || exhausted) {
      const waypoints = pathfinder
        .findPath(
          { x: position.x, y: position.y, z: position.z },
          { x: finalTarget.x, y: position.y, z: finalTarget.z }
        )
        .map((p) => ({ x: p.x, z: p.z }));
      if (waypoints.length === 0) {
        navPathByNpcId.delete(npcId); // off-mesh / unreachable -> straight-line
        return finalTarget;
      }
      path = {
        waypoints,
        // Skip the first corner when it's just the snapped start position.
        index:
          waypoints.length > 1 &&
          distance2d(position, waypoints[0]!) < WAYPOINT_ARRIVAL_METERS
            ? 1
            : 0,
        targetX: finalTarget.x,
        targetZ: finalTarget.z
      };
      navPathByNpcId.set(npcId, path);
    }
    return path.waypoints[path.index] ?? finalTarget;
  }

  /** Advance past every waypoint the NPC has reached this frame. */
  function advanceWaypoints(npcId: string, position: { x: number; z: number }) {
    const path = navPathByNpcId.get(npcId);
    if (!path) {
      return;
    }
    while (
      path.index < path.waypoints.length - 1 &&
      distance2d(position, path.waypoints[path.index]!) <= WAYPOINT_ARRIVAL_METERS
    ) {
      path.index += 1;
    }
  }

  /**
   * Commit an NPC's proposed step. Plan 069.3 — routes through the SAME
   * `resolveMove` as the player (collide-and-slide vs static boxes + push-
   * out vs other agents). Without a collision context (V1 / tests) it
   * writes the proposed position directly, preserving old behavior. The
   * RESOLVED position flows into stuck-detection: a slide makes progress
   * (not stuck), a pinned NPC makes none (stuck) — no separate tuning.
   */
  function commitNpcMove(
    position: { x: number; z: number },
    presenceId: string,
    proposedX: number,
    proposedZ: number
  ): void {
    const context = currentCollisionContext;
    if (!context) {
      position.x = proposedX;
      position.z = proposedZ;
      return;
    }
    let selfRadius = DEFAULT_NPC_AGENT_RADIUS;
    otherAgentCircles.length = 0;
    for (const agent of context.agents) {
      if (agent.id === presenceId) {
        selfRadius = agent.radius;
        continue;
      }
      otherAgentCircles.push({
        x: agent.x,
        z: agent.z,
        radius: agent.radius
      });
    }
    const resolved = resolveMove(
      { x: position.x, z: position.z, radius: selfRadius },
      { x: proposedX - position.x, z: proposedZ - position.z },
      context.world,
      otherAgentCircles
    );
    position.x += resolved.x;
    position.z += resolved.z;
  }

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

      // Plan 069.9 — arrival is measured against the FINAL authored point;
      // locomotion heads to the current navmesh waypoint toward it (or
      // straight there when unbaked). V1 stays planar x/z; vertical is the
      // later terrain layer.
      const distanceToFinal = distance2d(position, targetPoint);
      distanceToTargetMeters = distanceToFinal;

      if (distanceToFinal <= arrivalThresholdMeters) {
        commitNpcMove(position, npc.presenceId, targetPoint.x, targetPoint.z);
        state.status = "at_target";
        state.lastProgressAtMs = now();
        state.blockedAtMs = null;
        navPathByNpcId.delete(npc.npcDefinitionId);
      } else if (state.status !== "blocked") {
        const stepTarget = resolveStepTarget(
          npc.npcDefinitionId,
          position,
          targetPoint
        );
        const stepResult = stepToward({
          position,
          target: stepTarget,
          movementSpeedMetersPerSecond,
          deltaSeconds,
          arrivalThresholdMeters
        });
        // Plan 069.3 — resolved move (collide-and-slide + agent push-out);
        // the RESOLVED position feeds stuck-detection below.
        commitNpcMove(position, npc.presenceId, stepResult.x, stepResult.z);
        state.status = "en_route";
        advanceWaypoints(npc.npcDefinitionId, position);

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
          // Plan 069.9 — drop the stale route so a retry re-paths.
          navPathByNpcId.delete(npc.npcDefinitionId);
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
      // Plan 069.3 — snapshot the collision world + agent circles once for
      // the whole sync; every NPC's move this frame resolves against it.
      currentCollisionContext = getCollisionContext?.() ?? null;
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
        navPathByNpcId.delete(npcDefinitionId);
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
      navPathByNpcId.clear();
    },
    // ---- Plan 056 §056.2 — save participation ------------------------
    serializeSaveSlice(): NpcBehaviorSlice {
      const npcs: NpcBehaviorSlice["npcs"] = {};
      for (const npc of resolveNpcEntities()) {
        const position = world.getComponent(npc.entity, Position);
        if (!position) continue;
        const state = movementStateByNpcId.get(npc.npcDefinitionId) ?? null;
        npcs[npc.npcDefinitionId] = {
          position: { x: position.x, y: position.y, z: position.z },
          target: state
            ? {
                areaId: state.targetAreaId,
                taskId: state.targetTaskId
              }
            : null,
          status: state?.status ?? "idle"
        };
      }
      return { npcs };
    },
    deserializeSaveSlice(slice) {
      if (!slice) return;
      // Iterate the current NPC entities (already spawned by
      // `registerNpcInteractables` at assembly setup time).
      // For each NPC in the slice, look up its entity and
      // overwrite the Position component + reconstitute a
      // MovementState. NPCs in the slice whose definition is no
      // longer present (npcDefinition renamed / removed) drop
      // with a warn; NPCs newly-added since the save start at
      // their authored spawn point (no restoration needed).
      const entitiesByDefinitionId = new Map<
        string,
        { entity: Entity }
      >();
      for (const npc of resolveNpcEntities()) {
        entitiesByDefinitionId.set(npc.npcDefinitionId, {
          entity: npc.entity
        });
      }
      for (const [npcDefinitionId, saved] of Object.entries(
        slice.data.npcs ?? {}
      )) {
        const entry = entitiesByDefinitionId.get(npcDefinitionId);
        if (!entry) {
          console.warn(
            `[behavior] restore: dropping NPC "${npcDefinitionId}" — no matching definition in this region.`
          );
          continue;
        }
        const position = world.getComponent(entry.entity, Position);
        if (position) {
          position.x = saved.position.x;
          position.y = saved.position.y;
          position.z = saved.position.z;
        }
        // Rebuild movement state. Timestamps re-init to "now"
        // so stuck-detection has a fresh baseline (see slice
        // comment for the rationale on why we don't persist
        // wall-clock timestamps).
        const nowMs = now();
        movementStateByNpcId.set(npcDefinitionId, {
          targetAreaId: saved.target?.areaId ?? null,
          targetTaskId: saved.target?.taskId ?? null,
          // targetX/Z re-sampled on next sync tick when the
          // MovementDirective resolves.
          targetX: null,
          targetZ: null,
          lastX: saved.position.x,
          lastZ: saved.position.z,
          lastProgressAtMs: nowMs,
          blockedAtMs: null,
          status: saved.status
        });
      }
    }
  };
}
