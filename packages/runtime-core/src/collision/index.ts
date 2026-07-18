/**
 * Runtime collision world + collide-and-slide (Plan 069.2).
 *
 * The SINGLE collision enforcer. Pure, deterministic, framework-free (no
 * ECS, no host) so the player path (069.2) and the NPC path (069.3) route
 * the same `resolveMove` through it, and it unit-tests in isolation.
 *
 * Flat-ground scope (epic 069): agents are XZ circles, colliders are
 * world-space XZ AABBs (Y ignored). Gravity / ground-follow / slopes are
 * the deferred terrain epic.
 *
 * DEFERRED SEAMS (revisit triggers, epic 069.10):
 * - Vertical / terrain (the TERRAIN EPIC): the moment the ground stops being
 *   the flat `PlaneGeometry` at Y≈0 — i.e. when authors get height/slopes —
 *   `resolveMove` needs ground-follow + gravity + a real capsule half-height,
 *   and `WorldColliderAabb` must stop dropping Y. Do NOT bake more Y=0
 *   assumptions in here than already exist.
 * - CCD / swept collision: this resolver is DISCRETE (post-move push-out),
 *   correct at walking speed. Revisit when something moves fast enough to
 *   tunnel a collider in one frame — projectiles / dashes / spatial spells
 *   (none exist today; `CastableExecutor` is pure stat mutation).
 */

import * as THREE from "three";
import type {
  AssetColliderBounds,
  RegionAreaBounds,
  RegionBehaviorQuestBinding,
  RegionVolumeBlockDirection,
  RegionVolumeDefinition
} from "@sugarmagic/domain";
import type { SceneObject, SceneObjectTransform } from "../scene";
import {
  evaluateRegionQuestBinding,
  type RegionConditionContext
} from "../region-conditions";

/** World-space XZ axis-aligned box (Y dropped per flat-ground scope). */
export interface WorldColliderAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /**
   * Plan 069.5 — which boundary crossings block. `undefined` == `"in"`:
   * solid props (069.2) and out-of-bounds blockers keep you OUT (push-out).
   * `"out"` is a containment boundary — keeps an inside body IN. `"both"`
   * is an impermeable membrane (stay on whichever side you started).
   */
  block?: RegionVolumeBlockDirection;
  /**
   * Plan 069.5 — `false` disables the collider without removing it from the
   * grid. A conditional containment gate toggles this (see `gates` +
   * `applyVolumeColliderGates`). `undefined`/`true` == active.
   */
  active?: boolean;
}

/**
 * Plan 069.5 — a conditional collider (containment gate). While the bound
 * condition is NOT satisfied the collider blocks; once satisfied it opens
 * (`active = false`). Re-evaluated per frame via `applyVolumeColliderGates`.
 */
export interface VolumeColliderGate {
  colliderIndex: number;
  volumeId: string;
  condition: RegionBehaviorQuestBinding;
}

export interface CollisionWorld {
  colliders: WorldColliderAabb[];
  /** Uniform-grid broadphase: cell key -> indices into `colliders`. */
  readonly cellSize: number;
  readonly grid: Map<string, number[]>;
  /** Plan 069.5 — conditional colliders re-evaluated per frame. */
  gates: VolumeColliderGate[];
}

export interface CircleBody {
  x: number;
  z: number;
  radius: number;
  /** Agent id (069.9) — breaks the tie when two agents are EXACTLY coincident
   *  so they eject in opposite directions instead of drifting together. */
  id?: string;
}

/** A dynamic circle obstacle (Plan 069.3) — another agent (NPC/player)
 *  the mover must not interpenetrate. */
export interface CircleObstacle {
  x: number;
  z: number;
  radius: number;
  id?: string;
}

export interface Vec2 {
  x: number;
  z: number;
}

const DEFAULT_CELL_SIZE = 4;
const MAX_ITERATIONS = 4;
const EPSILON = 1e-6;

export function createEmptyCollisionWorld(): CollisionWorld {
  return {
    colliders: [],
    cellSize: DEFAULT_CELL_SIZE,
    grid: new Map(),
    gates: []
  };
}

const cellKey = (cx: number, cz: number): string => `${cx},${cz}`;
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

function insertIntoGrid(
  world: CollisionWorld,
  index: number,
  aabb: WorldColliderAabb
): void {
  const s = world.cellSize;
  const cx0 = Math.floor(aabb.minX / s);
  const cx1 = Math.floor(aabb.maxX / s);
  const cz0 = Math.floor(aabb.minZ / s);
  const cz1 = Math.floor(aabb.maxZ / s);
  for (let cx = cx0; cx <= cx1; cx += 1) {
    for (let cz = cz0; cz <= cz1; cz += 1) {
      const key = cellKey(cx, cz);
      const bucket = world.grid.get(key);
      if (bucket) {
        bucket.push(index);
      } else {
        world.grid.set(key, [index]);
      }
    }
  }
}

const _box = new THREE.Box3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/**
 * World XZ AABB enclosing a local AABB transformed by a scene transform.
 * A rotated box yields its enclosing (conservative) world AABB, which is
 * the right footprint for XZ-circle-vs-box blocking on flat ground.
 */
export function worldColliderAabb(
  transform: SceneObjectTransform,
  localBounds: AssetColliderBounds
): WorldColliderAabb {
  _pos.set(
    transform.position[0],
    transform.position[1],
    transform.position[2]
  );
  _euler.set(
    transform.rotation[0],
    transform.rotation[1],
    transform.rotation[2]
  );
  _quat.setFromEuler(_euler);
  _scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
  _mat.compose(_pos, _quat, _scale);
  _min.set(localBounds.min[0], localBounds.min[1], localBounds.min[2]);
  _max.set(localBounds.max[0], localBounds.max[1], localBounds.max[2]);
  _box.set(_min, _max).applyMatrix4(_mat);
  return {
    minX: _box.min.x,
    maxX: _box.max.x,
    minZ: _box.min.z,
    maxZ: _box.max.z
  };
}

/**
 * Build the collision world from resolved scene objects. Only placed
 * assets with a non-`"none"` collider and baked `localBounds` contribute;
 * agents (capsule) and items are skipped, and instanced vs singleton
 * placements are identical here (both read `SceneObject.transform`).
 */
export function buildCollisionWorld(
  sceneObjects: readonly SceneObject[],
  regionVolumes: readonly RegionVolumeDefinition[] = []
): CollisionWorld {
  const world = createEmptyCollisionWorld();
  for (const object of sceneObjects) {
    const collider = object.collider;
    // DEFERRED SEAM (069.10): shape is binary here — "none" vs solid. The
    // bounded variants (sphere/capsule/convex) are authorable but ALL
    // collide as this enclosing XZ AABB for now. Revisit trigger: an author
    // reports a round/organic prop whose square footprint blocks visibly
    // wrong (e.g. sliding around a tree trunk feels boxy) — then implement
    // circle-vs-sphere here (cheap) before capsule/convex.
    if (!collider || collider.shape === "none" || !collider.localBounds) {
      continue;
    }
    const aabb = worldColliderAabb(object.transform, collider.localBounds);
    const index = world.colliders.length;
    world.colliders.push(aabb);
    insertIntoGrid(world, index, aabb);
  }
  addVolumeColliders(world, regionVolumes);
  return world;
}

/** World XZ AABB from a region volume's (already world-space) box bounds. */
export function volumeBoundsAabb(bounds: RegionAreaBounds): WorldColliderAabb {
  const [cx, , cz] = bounds.center;
  const [sx, , sz] = bounds.size;
  const hx = Math.abs(sx) / 2;
  const hz = Math.abs(sz) / 2;
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
}

/**
 * Plan 069.5 — fold `blocker` / `containment-boundary` volumes into the
 * collision world. A blocker keeps you OUT (`block` defaults `"in"`); a
 * containment boundary keeps you IN (`block` defaults `"out"`); the authored
 * `blockDirection` overrides either. A volume with a `condition` becomes a
 * gate (initially blocking) toggled per frame by `applyVolumeColliderGates`.
 */
export function addVolumeColliders(
  world: CollisionWorld,
  regionVolumes: readonly RegionVolumeDefinition[]
): void {
  for (const volume of regionVolumes) {
    if (!volume.enabled) {
      continue;
    }
    const isBlocker = volume.roles.includes("blocker");
    const isContainment = volume.roles.includes("containment-boundary");
    if (!isBlocker && !isContainment) {
      continue;
    }
    const block: RegionVolumeBlockDirection =
      volume.blockDirection ?? (isContainment ? "out" : "in");
    const aabb = volumeBoundsAabb(volume.bounds);
    aabb.block = block;
    aabb.active = true;
    const index = world.colliders.length;
    world.colliders.push(aabb);
    insertIntoGrid(world, index, aabb);
    if (volume.condition) {
      world.gates.push({
        colliderIndex: index,
        volumeId: volume.volumeId,
        condition: volume.condition
      });
    }
  }
}

/**
 * Plan 069.5 — re-evaluate every conditional collider against the current
 * quest/flag state. A gate BLOCKS while its condition is unmet and OPENS
 * (deactivates) once satisfied — "walled in until you set the flag". Called
 * per frame on the shared world so the player and NPC resolve paths (which
 * hold the same world reference) both see the current gate state.
 */
export function applyVolumeColliderGates(
  world: CollisionWorld,
  context: RegionConditionContext
): void {
  for (const gate of world.gates) {
    const collider = world.colliders[gate.colliderIndex];
    if (!collider) {
      continue;
    }
    collider.active = !evaluateRegionQuestBinding(gate.condition, context);
  }
}

function queryColliders(
  world: CollisionWorld,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  out: WorldColliderAabb[],
  seen: Set<number>
): void {
  out.length = 0;
  seen.clear();
  if (world.colliders.length === 0) {
    return;
  }
  const s = world.cellSize;
  const cx0 = Math.floor(minX / s);
  const cx1 = Math.floor(maxX / s);
  const cz0 = Math.floor(minZ / s);
  const cz1 = Math.floor(maxZ / s);
  for (let cx = cx0; cx <= cx1; cx += 1) {
    for (let cz = cz0; cz <= cz1; cz += 1) {
      const bucket = world.grid.get(cellKey(cx, cz));
      if (!bucket) {
        continue;
      }
      for (const index of bucket) {
        if (seen.has(index)) {
          continue;
        }
        seen.add(index);
        out.push(world.colliders[index]!);
      }
    }
  }
}

/**
 * Collide-and-slide for an XZ circle against the world's box colliders.
 * Pure + deterministic + frame-rate independent (operates on the proposed
 * delta): applies `delta` to `from`, then push-out resolves against each
 * overlapping box along its surface normal only — which preserves the
 * tangential component, so a shallow-angle move SLIDES instead of dead-
 * stopping. Iterates to settle corners / multiple boxes. Returns the
 * resolved delta (final position minus `from`).
 */
export function resolveMove(
  from: CircleBody,
  delta: Vec2,
  world: CollisionWorld,
  circleObstacles: readonly CircleObstacle[] = []
): Vec2 {
  let x = from.x + delta.x;
  let z = from.z + delta.z;
  const r = from.radius;
  const candidates: WorldColliderAabb[] = [];
  const seen = new Set<number>();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let resolvedAny = false;

    // Dynamic circle obstacles (other agents) — push apart on overlap.
    for (const o of circleObstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      const combined = r + o.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq >= combined * combined) {
        continue;
      }
      if (distSq > EPSILON) {
        const dist = Math.sqrt(distSq);
        const push = (combined - dist) / dist;
        x += dx * push;
        z += dz * push;
      } else {
        // Exactly coincident (distSq ~ 0): eject along X, but pick the
        // direction from the id order so the OTHER agent (resolving against
        // this one's frame-start position) ejects the opposite way — else
        // both pick +X and drift together forever. No ids => +X.
        const dir = from.id && o.id && from.id < o.id ? -1 : 1;
        x += dir * combined;
      }
      resolvedAny = true;
    }

    // Query the swept range (start .. current), not just the post-move
    // point — a containment box the body is LEAVING sits back at the start
    // position, which a point query around an overshooting delta would miss
    // (and this also curbs prop tunneling on a fast move). The per-collider
    // distance/side tests below discard anything not actually touched.
    const qMinX = Math.min(from.x, x) - r;
    const qMaxX = Math.max(from.x, x) + r;
    const qMinZ = Math.min(from.z, z) - r;
    const qMaxZ = Math.max(from.z, z) + r;
    queryColliders(world, qMinX, qMaxX, qMinZ, qMaxZ, candidates, seen);
    for (const c of candidates) {
      if (c.active === false) {
        continue;
      }
      const block = c.block ?? "in";
      const fromInside =
        from.x >= c.minX &&
        from.x <= c.maxX &&
        from.z >= c.minZ &&
        from.z <= c.maxZ;

      // Plan 069.5 — containment: a body that STARTED inside is kept inside
      // (clamp its center to the box shrunk by the radius). "out" only ever
      // retains; "both" retains an inside body and (below) walls out an
      // outside one. A body already outside an "out" box is unconstrained.
      if (block === "out" || (block === "both" && fromInside)) {
        if (fromInside) {
          const loX = c.minX + r;
          const hiX = c.maxX - r;
          const loZ = c.minZ + r;
          const hiZ = c.maxZ - r;
          const nextX = loX <= hiX ? clamp(x, loX, hiX) : (c.minX + c.maxX) / 2;
          const nextZ = loZ <= hiZ ? clamp(z, loZ, hiZ) : (c.minZ + c.maxZ) / 2;
          if (nextX !== x || nextZ !== z) {
            x = nextX;
            z = nextZ;
            resolvedAny = true;
          }
        }
        continue;
      }

      // block === "in", or "both" from outside — solid: push the circle OUT.
      const closestX = clamp(x, c.minX, c.maxX);
      const closestZ = clamp(z, c.minZ, c.maxZ);
      const dx = x - closestX;
      const dz = z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= r * r) {
        continue;
      }
      if (distSq > EPSILON) {
        // Push out along the surface normal (tangential motion survives).
        const dist = Math.sqrt(distSq);
        const push = (r - dist) / dist;
        x += dx * push;
        z += dz * push;
      } else {
        // Circle center inside the box: eject along the shallowest axis.
        const penLeft = x - c.minX;
        const penRight = c.maxX - x;
        const penBack = z - c.minZ;
        const penFront = c.maxZ - z;
        const minPen = Math.min(penLeft, penRight, penBack, penFront);
        if (minPen === penLeft) {
          x = c.minX - r;
        } else if (minPen === penRight) {
          x = c.maxX + r;
        } else if (minPen === penBack) {
          z = c.minZ - r;
        } else {
          z = c.maxZ + r;
        }
      }
      resolvedAny = true;
    }
    if (!resolvedAny) {
      break;
    }
  }

  return { x: x - from.x, z: z - from.z };
}
