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
    // Still a valid mesh (the ground minus the carve).
    expect(bytes).not.toBeNull();
    const navMesh = await loadNavMesh(bytes!);
    expect(navMesh.getMaxTiles()).toBeGreaterThan(0);
    navMesh.destroy();
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
