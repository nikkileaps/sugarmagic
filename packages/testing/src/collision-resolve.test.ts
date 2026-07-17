/**
 * Runtime collision resolve (Plan 069.2).
 *
 * The pure collide-and-slide resolver + collision-world build. Covers the
 * story's cases: head-on block, shallow-angle slide, corner non-
 * penetration, "none"-collider pass-through, and delta-split determinism.
 */

import { describe, expect, it } from "vitest";
import type { AssetColliderShape } from "@sugarmagic/domain";
import {
  buildCollisionWorld,
  resolveMove,
  type SceneObject,
  type WorldColliderAabb
} from "@sugarmagic/runtime-core";

/** A minimal placed-asset SceneObject with a box collider centered at
 *  `center` with full extents `size` (identity rotation/scale). */
function boxObject(
  center: [number, number, number],
  size: [number, number, number],
  shape: AssetColliderShape = "auto-box"
): SceneObject {
  return {
    instanceId: "box",
    kind: "asset",
    displayName: "Box",
    assetDefinitionId: "asset:box",
    assetKind: "model",
    modelSourcePath: null,
    targetModelHeight: null,
    effectiveShaders: { surface: null, deform: null, effect: null },
    effectiveMaterialSlots: [],
    transform: { position: center, rotation: [0, 0, 0], scale: [1, 1, 1] },
    representationKey: "box",
    capsule: null,
    collider: {
      shape,
      localBounds: {
        min: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
        max: [size[0] / 2, size[1] / 2, size[2] / 2]
      }
    }
  };
}

function overlaps(
  x: number,
  z: number,
  radius: number,
  aabb: WorldColliderAabb
): boolean {
  const cx = Math.max(aabb.minX, Math.min(x, aabb.maxX));
  const cz = Math.max(aabb.minZ, Math.min(z, aabb.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < radius * radius - 1e-6;
}

describe("buildCollisionWorld", () => {
  it("realizes a world AABB for an auto-box asset and skips 'none'", () => {
    const solid = buildCollisionWorld([boxObject([3, 0, 0], [2, 2, 2])]);
    expect(solid.colliders).toHaveLength(1);
    expect(solid.colliders[0]).toMatchObject({
      minX: 2,
      maxX: 4,
      minZ: -1,
      maxZ: 1
    });

    const decor = buildCollisionWorld([
      boxObject([3, 0, 0], [2, 2, 2], "none")
    ]);
    expect(decor.colliders).toHaveLength(0);
  });
});

describe("resolveMove", () => {
  it("blocks a head-on move at the box face (minus radius)", () => {
    const world = buildCollisionWorld([boxObject([0, 0, 0], [2, 2, 2])]); // XZ [-1,1]
    // From z=-2, move +1 toward the box; radius 0.5 stops the center at -1.5.
    const resolved = resolveMove({ x: 0, z: -2, radius: 0.5 }, { x: 0, z: 1 }, world);
    expect(-2 + resolved.z).toBeCloseTo(-1.5, 3);
    expect(resolved.x).toBeCloseTo(0, 3);
  });

  it("slides along a wall on a shallow-angle move (tangential survives)", () => {
    // Wall facing -Z: XZ x[-5,5], z[0,1]. Approach diagonally into it.
    const world = buildCollisionWorld([boxObject([0, 0, 0.5], [10, 2, 1])]);
    const resolved = resolveMove({ x: 0, z: -1, radius: 0.5 }, { x: 2, z: 1 }, world);
    const finalX = 0 + resolved.x;
    const finalZ = -1 + resolved.z;
    expect(finalX).toBeCloseTo(2, 2); // X slid the full amount...
    expect(finalZ).toBeCloseTo(-0.5, 2); // ...while Z was blocked at the face
  });

  it("does not penetrate either box in a concave corner", () => {
    // North wall + east wall meeting at (1,1).
    const north = boxObject([0, 0, 2], [2, 2, 2]); // x[-1,1], z[1,3]
    const east = boxObject([2, 0, 0], [2, 2, 2]); // x[1,3], z[-1,1]
    const world = buildCollisionWorld([north, east]);
    const northAabb = world.colliders[0]!;
    const eastAabb = world.colliders[1]!;
    // Drive into the corner from inside.
    const resolved = resolveMove(
      { x: 0.5, z: 0.5, radius: 0.5 },
      { x: 0.6, z: 0.6 },
      world
    );
    const fx = 0.5 + resolved.x;
    const fz = 0.5 + resolved.z;
    expect(overlaps(fx, fz, 0.5, northAabb)).toBe(false);
    expect(overlaps(fx, fz, 0.5, eastAabb)).toBe(false);
  });

  it("passes straight through a 'none' collider (empty world)", () => {
    const world = buildCollisionWorld([boxObject([0, 0, 0], [2, 2, 2], "none")]);
    const resolved = resolveMove({ x: 0, z: -2, radius: 0.5 }, { x: 0, z: 4 }, world);
    expect(resolved.x).toBeCloseTo(0, 6);
    expect(resolved.z).toBeCloseTo(4, 6); // full move, unblocked
  });

  it("is deterministic across a delta split (one step vs two halves)", () => {
    const world = buildCollisionWorld([boxObject([0, 0, 0.5], [10, 2, 1])]);
    const full = resolveMove({ x: 0, z: -1, radius: 0.5 }, { x: 2, z: 1 }, world);
    const fullX = 0 + full.x;
    const fullZ = -1 + full.z;

    const half1 = resolveMove({ x: 0, z: -1, radius: 0.5 }, { x: 1, z: 0.5 }, world);
    const midX = 0 + half1.x;
    const midZ = -1 + half1.z;
    const half2 = resolveMove({ x: midX, z: midZ, radius: 0.5 }, { x: 1, z: 0.5 }, world);
    const splitX = midX + half2.x;
    const splitZ = midZ + half2.z;

    expect(splitX).toBeCloseTo(fullX, 2);
    expect(splitZ).toBeCloseTo(fullZ, 2);
  });
});
