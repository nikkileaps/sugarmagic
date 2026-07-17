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
 */

import * as THREE from "three";
import type { AssetColliderBounds } from "@sugarmagic/domain";
import type { SceneObject, SceneObjectTransform } from "../scene";

/** World-space XZ axis-aligned box (Y dropped per flat-ground scope). */
export interface WorldColliderAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CollisionWorld {
  colliders: WorldColliderAabb[];
  /** Uniform-grid broadphase: cell key -> indices into `colliders`. */
  readonly cellSize: number;
  readonly grid: Map<string, number[]>;
}

export interface CircleBody {
  x: number;
  z: number;
  radius: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

const DEFAULT_CELL_SIZE = 4;
const MAX_ITERATIONS = 4;
const EPSILON = 1e-6;

export function createEmptyCollisionWorld(): CollisionWorld {
  return { colliders: [], cellSize: DEFAULT_CELL_SIZE, grid: new Map() };
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
  sceneObjects: readonly SceneObject[]
): CollisionWorld {
  const world = createEmptyCollisionWorld();
  for (const object of sceneObjects) {
    const collider = object.collider;
    if (!collider || collider.shape === "none" || !collider.localBounds) {
      continue;
    }
    const aabb = worldColliderAabb(object.transform, collider.localBounds);
    const index = world.colliders.length;
    world.colliders.push(aabb);
    insertIntoGrid(world, index, aabb);
  }
  return world;
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
  world: CollisionWorld
): Vec2 {
  let x = from.x + delta.x;
  let z = from.z + delta.z;
  const r = from.radius;
  const candidates: WorldColliderAabb[] = [];
  const seen = new Set<number>();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    queryColliders(world, x - r, x + r, z - r, z + r, candidates, seen);
    let resolvedAny = false;
    for (const c of candidates) {
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
