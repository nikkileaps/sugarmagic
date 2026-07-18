/**
 * NavMesh bake + artifact round-trip (Plan 069.8).
 *
 * Validates the recast integration end to end in our env: bake a walkable
 * ground with an obstacle carving it, get exported bytes, and re-import
 * them into a live NavMesh. Also the empty-input guard.
 */

import { describe, expect, it } from "vitest";
import {
  bakeNavMesh,
  computeNavMeshInputHash,
  loadNavMesh,
  loadNavMeshDebugGeometry,
  loadNavMeshPathfinder,
  type NavMeshBakeInput,
  type WorldColliderAabb
} from "@sugarmagic/runtime-core";
import type { RegionAreaBounds } from "@sugarmagic/domain";

const navBounds: RegionAreaBounds = {
  kind: "box",
  center: [0, 0, 0],
  size: [20, 4, 20]
};

/** True when any GROUND-LEVEL walkable triangle covers (x, z). Obstacle box
 *  TOPS are also walkable (disconnected islands at obstacleHeight, harmless
 *  — paths can't reach them), so filter to y < 1 to test the ground layer. */
function coversPointXZ(
  positions: number[],
  indices: number[],
  x: number,
  z: number
): boolean {
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    if (
      positions[a + 1]! > 1 ||
      positions[b + 1]! > 1 ||
      positions[c + 1]! > 1
    ) {
      continue; // an obstacle-top island, not the ground layer
    }
    const ax = positions[a]!, az = positions[a + 2]!;
    const bx = positions[b]!, bz = positions[b + 2]!;
    const cx = positions[c]!, cz = positions[c + 2]!;
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
    const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
    const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNeg && hasPos)) {
      return true;
    }
  }
  return false;
}
const propCollider: WorldColliderAabb = {
  minX: -1,
  maxX: 1,
  minZ: -1,
  maxZ: 1
};

describe("069.8 — navmesh bake", () => {
  it("bakes a walkable ground with a prop cutout and round-trips the bytes", async () => {
    const bytes = await bakeNavMesh({
      colliders: [propCollider],
      navBounds: [navBounds],
      nonWalkable: [],
      agentRadius: 0.35
    });
    expect(bytes).not.toBeNull();
    expect(bytes!.byteLength).toBeGreaterThan(0);

    // The artifact re-imports into a usable NavMesh.
    const navMesh = await loadNavMesh(bytes!);
    expect(navMesh.getMaxTiles()).toBeGreaterThan(0);
    navMesh.destroy();
  });

  it("carves a non-walkable volume out of the ground", async () => {
    const bytes = await bakeNavMesh({
      colliders: [],
      navBounds: [navBounds],
      nonWalkable: [{ kind: "box", center: [5, 0, 5], size: [4, 4, 4] }],
      agentRadius: 0.35
    });
    expect(bytes).not.toBeNull();
    // Assert the CARVE actually carved: the walkable triangles must cover an
    // open-ground point but NOT the carve center (mini-review r3 tightening).
    // Samples nudged off the voxel gridlines (axis-aligned triangle edges
    // make exactly-on-line points ambiguous for the sign test).
    const { positions, indices } = await loadNavMeshDebugGeometry(bytes!);
    expect(coversPointXZ(positions, indices, -5.1, -5.1)).toBe(true); // open ground
    expect(coversPointXZ(positions, indices, 5.1, 5.1)).toBe(false); // inside carve
  });

  it("returns null when there are no nav-bounds (nothing walkable)", async () => {
    const bytes = await bakeNavMesh({
      colliders: [propCollider],
      navBounds: [],
      nonWalkable: [],
      agentRadius: 0.35
    });
    expect(bytes).toBeNull();
  });
});

describe("069.9 — navmesh pathfinding", () => {
  it("routes AROUND a wall (path bends) and direct across open ground", async () => {
    // A wall spanning most of the width, with a gap forcing a detour.
    const wall: WorldColliderAabb = { minX: -8, maxX: 6, minZ: -0.5, maxZ: 0.5 };
    const bytes = await bakeNavMesh({
      colliders: [wall],
      navBounds: [navBounds],
      nonWalkable: [],
      agentRadius: 0.35
    });
    expect(bytes).not.toBeNull();
    const pathfinder = await loadNavMeshPathfinder(bytes!);

    // From below the wall to above it — must detour through the gap (>2 pts).
    const around = pathfinder.findPath({ x: 0, y: 0, z: -6 }, { x: 0, y: 0, z: 6 });
    expect(around.length).toBeGreaterThan(0);
    const arrived = around[around.length - 1]!;
    expect(Math.hypot(arrived.x - 0, arrived.z - 6)).toBeLessThan(1.5);
    // The route bows toward the gap (max |x| along the path clears the wall end).
    const maxX = Math.max(...around.map((p) => p.x));
    expect(maxX).toBeGreaterThan(5);

    pathfinder.destroy();
  });

  it("returns a path across open ground with no obstacles", async () => {
    const bytes = await bakeNavMesh({
      colliders: [],
      navBounds: [navBounds],
      nonWalkable: [],
      agentRadius: 0.35
    });
    const pathfinder = await loadNavMeshPathfinder(bytes!);
    const path = pathfinder.findPath({ x: -6, y: 0, z: -6 }, { x: 6, y: 0, z: 6 });
    expect(path.length).toBeGreaterThanOrEqual(2);
    pathfinder.destroy();
  });
});

describe("069.8 — navmesh staleness hash", () => {
  const base: NavMeshBakeInput = {
    colliders: [propCollider, { minX: 4, maxX: 6, minZ: 4, maxZ: 6 }],
    navBounds: [navBounds],
    nonWalkable: [],
    agentRadius: 0.35
  };

  it("is stable + order-independent over the collider list", () => {
    const reordered: NavMeshBakeInput = {
      ...base,
      colliders: [...base.colliders].reverse()
    };
    expect(computeNavMeshInputHash(base)).toBe(computeNavMeshInputHash(reordered));
  });

  it("changes when a collider moves (edit postdates the bake)", () => {
    const moved: NavMeshBakeInput = {
      ...base,
      colliders: [{ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }, base.colliders[1]!]
    };
    expect(computeNavMeshInputHash(moved)).not.toBe(computeNavMeshInputHash(base));
  });

  it("changes when the agent radius changes", () => {
    expect(
      computeNavMeshInputHash({ ...base, agentRadius: 0.5 })
    ).not.toBe(computeNavMeshInputHash(base));
  });
});
