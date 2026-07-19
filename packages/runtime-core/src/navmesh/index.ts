/**
 * NavMesh bake + artifact round-trip (Plan 069.8).
 *
 * The SINGLE navmesh enforcer: the studio bakes from the collision world's
 * geometry (this module, exported bytes -> asset-source store), and the
 * runtime imports the same bytes here for pathfinding (069.9). Built on
 * `recast-navigation` (solo navmesh; tiled/TileCache is a future gate).
 *
 * Flat-ground scope (epic 069): the walkable surface is the ground plane
 * inside the `nav-bounds` volumes; collider boxes + `non-walkable` volumes
 * are obstacle boxes that carve the ground (recast rasterizes them and
 * erodes the walkable area by the agent radius). Recast consumes triangle
 * SOUP (flat positions + indices), so every box becomes its 12 triangles
 * and each nav-bounds volume contributes a ground quad.
 *
 * DEFERRED SEAMS (revisit triggers, epic 069.10):
 * - Tiled bake + `TileCache`: this is a SOLO navmesh (one tile). Revisit when
 *   (a) a region gets big enough that a single-tile bake is too coarse/slow,
 *   or (b) we need RUNTIME dynamic obstacles (recast `TileCache` box/cylinder
 *   carving requires a TILED navmesh). Swap `generateSoloNavMesh` for
 *   `generateTiledNavMesh` / `generateTileCache` at that point.
 * - 3D terrain bake: the soup is flat (ground quad at `groundY`). When the
 *   terrain epic lands, feed the actual terrain triangles instead — recast
 *   already handles slopes/steps, so `walkableSlopeAngle` starts mattering.
 */

import {
  exportNavMesh,
  getNavMeshPositionsAndIndices,
  importNavMesh,
  init,
  NavMeshQuery,
  type NavMesh
} from "@recast-navigation/core";
import { generateSoloNavMesh } from "@recast-navigation/generators";
import {
  resolveRegionVolumes,
  type ContentLibrarySnapshot,
  type ItemDefinition,
  type NPCDefinition,
  type PlayerDefinition,
  type RegionAreaBounds,
  type RegionDocument,
  type Scene
} from "@sugarmagic/domain";
import {
  volumeBoundsAabb,
  worldColliderAabb,
  type WorldColliderAabb
} from "../collision";
import { computePlayerAgentDimensions, resolveSceneObjects } from "../scene";

let recastReady: Promise<void> | null = null;

/** Initialize the recast WASM once (idempotent); every bake/load awaits it. */
export function ensureRecastInit(): Promise<void> {
  if (!recastReady) {
    recastReady = init();
  }
  return recastReady;
}

export interface NavMeshBakeInput {
  /** Static world colliders (props + blocker volumes) — obstacle boxes. */
  colliders: readonly WorldColliderAabb[];
  /** `nav-bounds` volume footprints — where the ground is walkable. */
  navBounds: readonly RegionAreaBounds[];
  /** `non-walkable` volume footprints — carve-outs (obstacle boxes). */
  nonWalkable: readonly RegionAreaBounds[];
  /** Agent radius (world units) — recast erodes the walkable area by it. */
  agentRadius: number;
  /** Ground plane height (flat-ground scope; defaults to 0). */
  groundY?: number;
  /** Voxel cell size (world units); smaller = finer + slower. */
  cellSize?: number;
  /** Obstacle box height above the ground (must exceed agent height so
   *  recast treats footprints as walls, not step-overs). */
  obstacleHeight?: number;
}

const DEFAULT_CELL_SIZE = 0.3;
const DEFAULT_OBSTACLE_HEIGHT = 3;

interface TriangleSoup {
  positions: number[];
  indices: number[];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

/** Up-facing quad (normal +Y so recast marks it walkable). */
function addGroundQuad(
  soup: TriangleSoup,
  bounds: RegionAreaBounds,
  y: number
): void {
  const [cx, , cz] = bounds.center;
  const [sx, , sz] = bounds.size;
  const x0 = cx - Math.abs(sx) / 2;
  const x1 = cx + Math.abs(sx) / 2;
  const z0 = cz - Math.abs(sz) / 2;
  const z1 = cz + Math.abs(sz) / 2;
  const b = soup.positions.length / 3;
  // A(x0,z0) B(x1,z0) C(x1,z1) D(x0,z1)
  soup.positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
  // Winding (A,D,C)+(A,C,B) => +Y normal.
  soup.indices.push(b, b + 3, b + 2, b, b + 2, b + 1);
}

/**
 * Down-facing quad just above the ground over an obstacle footprint. Recast
 * rasterizes triangle SURFACES (boxes are hollow), so the ground inside a
 * large box keeps full headroom to the box top and stays walkable — only the
 * wall ring carved. This "kill ceiling" is slope-filtered (never walkable
 * itself) and reduces the footprint's clearance below the agent height, so
 * the ground beneath is culled — interiors carve, not just perimeters.
 */
function addKillCeiling(
  soup: TriangleSoup,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number
): void {
  const b = soup.positions.length / 3;
  soup.positions.push(minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ);
  // Reverse winding vs addGroundQuad => -Y normal (never walkable).
  soup.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

const KILL_CEILING_CLEARANCE = 0.5;

/** All 12 triangles of an axis-aligned box (obstacle geometry). */
function addBox(
  soup: TriangleSoup,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number
): void {
  const b = soup.positions.length / 3;
  soup.positions.push(
    minX, minY, minZ, // 0
    maxX, minY, minZ, // 1
    maxX, minY, maxZ, // 2
    minX, minY, maxZ, // 3
    minX, maxY, minZ, // 4
    maxX, maxY, minZ, // 5
    maxX, maxY, maxZ, // 6
    minX, maxY, maxZ // 7
  );
  const q = (a: number, c: number, d: number, e: number) => {
    soup.indices.push(b + a, b + c, b + d, b + a, b + d, b + e);
  };
  q(4, 5, 6, 7); // top (+Y)
  q(0, 3, 2, 1); // bottom (-Y)
  q(0, 1, 5, 4); // -Z
  q(2, 3, 7, 6); // +Z
  q(1, 2, 6, 5); // +X
  q(3, 0, 4, 7); // -X
}

function buildTriangleSoup(input: NavMeshBakeInput): TriangleSoup | null {
  const groundY = input.groundY ?? 0;
  const obstacleTop = groundY + (input.obstacleHeight ?? DEFAULT_OBSTACLE_HEIGHT);
  const soup: TriangleSoup = {
    positions: [],
    indices: [],
    boundsMin: [Infinity, Infinity, Infinity],
    boundsMax: [-Infinity, -Infinity, -Infinity]
  };

  if (input.navBounds.length === 0) {
    return null; // nothing to walk on
  }
  for (const bounds of input.navBounds) {
    addGroundQuad(soup, bounds, groundY);
  }
  const killY = groundY + KILL_CEILING_CLEARANCE;
  for (const c of input.colliders) {
    addBox(soup, c.minX, c.maxX, groundY, obstacleTop, c.minZ, c.maxZ);
    addKillCeiling(soup, c.minX, c.maxX, c.minZ, c.maxZ, killY);
  }
  for (const nw of input.nonWalkable) {
    const [cx, , cz] = nw.center;
    const [sx, , sz] = nw.size;
    const minX = cx - Math.abs(sx) / 2;
    const maxX = cx + Math.abs(sx) / 2;
    const minZ = cz - Math.abs(sz) / 2;
    const maxZ = cz + Math.abs(sz) / 2;
    addBox(soup, minX, maxX, groundY, obstacleTop, minZ, maxZ);
    addKillCeiling(soup, minX, maxX, minZ, maxZ, killY);
  }

  for (let i = 0; i < soup.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const v = soup.positions[i + axis]!;
      if (v < soup.boundsMin[axis]) soup.boundsMin[axis] = v;
      if (v > soup.boundsMax[axis]) soup.boundsMax[axis] = v;
    }
  }
  return soup;
}

/**
 * Bake a solo navmesh from the collision geometry and return the exported
 * bytes (the artifact the studio publishes / the runtime imports). Returns
 * `null` when there is nothing walkable or recast fails (logged).
 */
export async function bakeNavMesh(
  input: NavMeshBakeInput
): Promise<Uint8Array | null> {
  await ensureRecastInit();
  const soup = buildTriangleSoup(input);
  if (!soup || soup.indices.length === 0) {
    return null;
  }
  const cs = input.cellSize ?? DEFAULT_CELL_SIZE;
  const ch = cs / 2;
  // recast walkableRadius/Height are in VOXELS, not world units.
  const walkableRadius = Math.max(1, Math.ceil(input.agentRadius / cs));
  const result = generateSoloNavMesh(soup.positions, soup.indices, {
    cs,
    ch,
    walkableRadius,
    walkableHeight: Math.max(1, Math.ceil(2 / ch)),
    walkableClimb: Math.max(0, Math.floor(0.3 / ch)),
    walkableSlopeAngle: 45,
    bounds: [soup.boundsMin, soup.boundsMax]
  });
  if (!result.success) {
    console.warn("[navmesh] bake failed", result.error);
    return null;
  }
  const bytes = exportNavMesh(result.navMesh);
  result.navMesh.destroy();
  return bytes;
}

// Recast's NavMeshSetHeader magic ('MSET', little-endian on the wire).
// `importNavMesh` does NOT validate it -- feeding it non-artifact bytes (an
// HTML 404 body, a truncated file) returns a structurally-live NavMesh whose
// first query crashes the WASM with a memory-access error, killing the rAF
// loop (hard freeze). Every import path below goes through this gate instead.
const NAVMESH_SET_MAGIC = 0x4d534554;

function assertNavMeshArtifact(bytes: Uint8Array): void {
  const magic =
    bytes.length >= 4
      ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
      : 0;
  if (magic !== NAVMESH_SET_MAGIC) {
    throw new Error(
      `[navmesh] bytes are not a baked navmesh artifact (bad magic; got ${bytes.length} bytes)`
    );
  }
}

/** Import a baked navmesh artifact for runtime queries (069.9). */
export async function loadNavMesh(bytes: Uint8Array): Promise<NavMesh> {
  await ensureRecastInit();
  assertNavMeshArtifact(bytes);
  return importNavMesh(bytes).navMesh;
}

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * NPC pathfinding over a baked navmesh (Plan 069.9). Wraps a recast
 * `NavMeshQuery`: `findPath` snaps the endpoints onto the mesh and returns
 * the straight-path waypoints (empty when off-mesh or unreachable). The
 * behavior stepper follows these waypoints instead of a straight line;
 * resolveMove (069.3) stays the final collision clip. Owns the NavMesh —
 * `destroy()` frees both.
 */
export interface NavMeshPathfinder {
  findPath(from: NavPoint, to: NavPoint): NavPoint[];
  destroy(): void;
}

export function createNavMeshPathfinder(navMesh: NavMesh): NavMeshPathfinder {
  const query = new NavMeshQuery(navMesh);
  return {
    findPath(from, to) {
      const start = query.findClosestPoint(from);
      const end = query.findClosestPoint(to);
      if (!start.success || !end.success) {
        return [];
      }
      const result = query.computePath(start.point, end.point);
      if (!result.success) {
        return [];
      }
      return result.path.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    },
    destroy() {
      query.destroy();
      navMesh.destroy();
    }
  };
}

/** Load a baked artifact directly into a pathfinder (runtime host). */
export async function loadNavMeshPathfinder(
  bytes: Uint8Array
): Promise<NavMeshPathfinder> {
  await ensureRecastInit();
  assertNavMeshArtifact(bytes);
  return createNavMeshPathfinder(importNavMesh(bytes).navMesh);
}

/**
 * Extract the walkable-surface triangles from a baked artifact for
 * visualization (Plan 069.8 "show navmesh" toggle). Self-contained: loads,
 * reads positions/indices, frees the WASM NavMesh — the caller just draws.
 */
export async function loadNavMeshDebugGeometry(
  bytes: Uint8Array
): Promise<{ positions: number[]; indices: number[] }> {
  await ensureRecastInit();
  assertNavMeshArtifact(bytes);
  const navMesh = importNavMesh(bytes).navMesh;
  const [positions, indices] = getNavMeshPositionsAndIndices(navMesh);
  navMesh.destroy();
  return { positions, indices };
}

export interface RegionNavMeshInputOptions {
  region: RegionDocument;
  contentLibrary: ContentLibrarySnapshot;
  playerDefinition: PlayerDefinition | null;
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  activeScene?: Scene | null;
  cellSize?: number;
}

/**
 * Derive the navmesh bake inputs from a region (Plan 069.8). Obstacles are
 * the prop colliders + `blocker` volumes — NOT `containment-boundary`
 * volumes (those bound the play area you navigate INSIDE, so they must not
 * carve). `nav-bounds` volumes are the walkable ground; `non-walkable`
 * volumes carve. Shared by the studio bake action AND its staleness check so
 * both hash the exact same inputs.
 *
 * DEFERRED SEAM (069.10): `activeScene` composes ONE Scene's overlay into
 * the obstacle set (scene collider overrides, scene-contained placements),
 * but the resulting artifact is stored region-global — a runtime playing a
 * DIFFERENT Scene paths against this Scene's geometry. The artifact records
 * its `sceneId` for provenance. Revisit trigger: a Scene meaningfully alters
 * collision (walls added/removed) and NPCs path wrong there → per-Scene
 * artifacts keyed by scene id.
 */
export function buildRegionNavMeshInput(
  options: RegionNavMeshInputOptions
): NavMeshBakeInput {
  const objects = resolveSceneObjects(options.region, {
    contentLibrary: options.contentLibrary,
    playerDefinition: options.playerDefinition ?? undefined,
    itemDefinitions: options.itemDefinitions,
    npcDefinitions: options.npcDefinitions,
    includePlayerPresence: false,
    activeScene: options.activeScene ?? null
  });
  const colliders: WorldColliderAabb[] = [];
  for (const object of objects) {
    const collider = object.collider;
    if (!collider || collider.shape === "none" || !collider.localBounds) {
      continue;
    }
    colliders.push(worldColliderAabb(object.transform, collider.localBounds));
  }
  const volumes = resolveRegionVolumes(options.region).filter((v) => v.enabled);
  for (const volume of volumes) {
    if (volume.roles.includes("blocker")) {
      colliders.push(volumeBoundsAabb(volume.bounds));
    }
  }
  return {
    colliders,
    navBounds: volumes
      .filter((v) => v.roles.includes("nav-bounds"))
      .map((v) => v.bounds),
    nonWalkable: volumes
      .filter((v) => v.roles.includes("non-walkable"))
      .map((v) => v.bounds),
    agentRadius: computePlayerAgentDimensions(options.playerDefinition).radius,
    cellSize: options.cellSize
  };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Deterministic hash of the bake INPUTS (Plan 069.8 staleness). The studio
 * stores this in the artifact at bake time and re-derives it from the
 * current colliders + nav volumes; a mismatch means a collider-touching edit
 * postdates the bake -> show the "rebake" warning. Order-independent (sorted)
 * so re-ordering collider lists doesn't falsely invalidate.
 */
export function computeNavMeshInputHash(input: NavMeshBakeInput): string {
  const colliderKeys = input.colliders
    .map((c) => `${round(c.minX)},${round(c.maxX)},${round(c.minZ)},${round(c.maxZ)}`)
    .sort();
  const boundsKey = (b: RegionAreaBounds): string =>
    `${round(b.center[0])},${round(b.center[1])},${round(b.center[2])}|${round(b.size[0])},${round(b.size[1])},${round(b.size[2])}`;
  const navKeys = input.navBounds.map(boundsKey).sort();
  const carveKeys = input.nonWalkable.map(boundsKey).sort();
  const payload = JSON.stringify({
    c: colliderKeys,
    n: navKeys,
    x: carveKeys,
    r: round(input.agentRadius),
    s: round(input.cellSize ?? DEFAULT_CELL_SIZE),
    g: round(input.groundY ?? 0)
  });
  // djb2
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
