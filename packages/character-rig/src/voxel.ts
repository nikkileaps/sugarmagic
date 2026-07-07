/**
 * packages/character-rig/src/voxel.ts
 *
 * Purpose: Plan 062 §062.2 — solid voxelization for the geodesic
 * weight solver. Surface voxels come from sampling every
 * triangle; interior voxels are everything a flood fill from the
 * grid boundary CANNOT reach through empty cells. Non-watertight
 * tolerance falls out of the sampling: small holes seal at
 * typical resolutions, and a badly open mesh degrades to
 * surface-only traversal instead of failing.
 *
 * The traversable set (surface + interior) is the graph the
 * weight solver runs geodesic distances over — distances flow
 * THROUGH the body, never across empty space, which is what
 * stops the left thigh claiming right-leg vertices.
 *
 * Status: active
 */

import { computeMeshBounds, type MeshData } from "./mesh";
import type { Vec3 } from "./math";

export const VOXEL_EMPTY = 0;
export const VOXEL_SURFACE = 1;
export const VOXEL_INTERIOR = 2;

export interface VoxelGrid {
  dims: [number, number, number];
  origin: Vec3;
  cellSize: number;
  /** VOXEL_* per cell, x-major: index = x + y*dx + z*dx*dy. */
  cells: Uint8Array;
}

export function voxelIndex(grid: VoxelGrid, x: number, y: number, z: number): number {
  return x + y * grid.dims[0] + z * grid.dims[0] * grid.dims[1];
}

export function worldToVoxel(
  grid: VoxelGrid,
  position: Vec3
): [number, number, number] {
  return [
    Math.min(
      grid.dims[0] - 1,
      Math.max(0, Math.floor((position[0] - grid.origin[0]) / grid.cellSize))
    ),
    Math.min(
      grid.dims[1] - 1,
      Math.max(0, Math.floor((position[1] - grid.origin[1]) / grid.cellSize))
    ),
    Math.min(
      grid.dims[2] - 1,
      Math.max(0, Math.floor((position[2] - grid.origin[2]) / grid.cellSize))
    )
  ];
}

/**
 * Voxelize a mesh. `resolution` is the cell count along the
 * longest AABB axis; 64-128 is the intended range (Plan 062
 * decision 2).
 */
export function voxelizeMesh(mesh: MeshData, resolution: number): VoxelGrid {
  const bounds = computeMeshBounds(mesh);
  const size = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  ];
  const longest = Math.max(size[0]!, size[1]!, size[2]!, 1e-6);
  const cellSize = longest / resolution;
  // One-cell padding on every side so the exterior flood fill can
  // wrap the model.
  const dims: [number, number, number] = [
    Math.max(3, Math.ceil(size[0]! / cellSize) + 2),
    Math.max(3, Math.ceil(size[1]! / cellSize) + 2),
    Math.max(3, Math.ceil(size[2]! / cellSize) + 2)
  ];
  const origin: Vec3 = [
    bounds.min[0] - cellSize,
    bounds.min[1] - cellSize,
    bounds.min[2] - cellSize
  ];
  const grid: VoxelGrid = {
    dims,
    origin,
    cellSize,
    cells: new Uint8Array(dims[0] * dims[1] * dims[2])
  };

  // Surface: sample each triangle at sub-cell spacing.
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i]! * 3;
    const ib = mesh.indices[i + 1]! * 3;
    const ic = mesh.indices[i + 2]! * 3;
    const a: Vec3 = [p[ia]!, p[ia + 1]!, p[ia + 2]!];
    const b: Vec3 = [p[ib]!, p[ib + 1]!, p[ib + 2]!];
    const c: Vec3 = [p[ic]!, p[ic + 1]!, p[ic + 2]!];
    const edge1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const edge2 = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const steps = Math.max(
      1,
      Math.ceil((Math.max(edge1, edge2) / cellSize) * 2)
    );
    for (let u = 0; u <= steps; u += 1) {
      for (let v = 0; v <= steps - u; v += 1) {
        const s = u / steps;
        const t = v / steps;
        const w = 1 - s - t;
        const point: Vec3 = [
          a[0] * w + b[0] * s + c[0] * t,
          a[1] * w + b[1] * s + c[1] * t,
          a[2] * w + b[2] * s + c[2] * t
        ];
        const [x, y, z] = worldToVoxel(grid, point);
        grid.cells[voxelIndex(grid, x, y, z)] = VOXEL_SURFACE;
      }
    }
  }

  // Exterior flood fill from the padded boundary; unreached empty
  // cells are interior.
  const exterior = new Uint8Array(grid.cells.length);
  const queue = new Int32Array(grid.cells.length);
  let head = 0;
  let tail = 0;
  const pushIfEmpty = (x: number, y: number, z: number) => {
    if (
      x < 0 || y < 0 || z < 0 ||
      x >= dims[0] || y >= dims[1] || z >= dims[2]
    ) {
      return;
    }
    const index = voxelIndex(grid, x, y, z);
    if (exterior[index] || grid.cells[index] !== VOXEL_EMPTY) return;
    exterior[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  pushIfEmpty(0, 0, 0);
  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    const x = index % dims[0];
    const y = Math.floor(index / dims[0]) % dims[1];
    const z = Math.floor(index / (dims[0] * dims[1]));
    pushIfEmpty(x + 1, y, z);
    pushIfEmpty(x - 1, y, z);
    pushIfEmpty(x, y + 1, z);
    pushIfEmpty(x, y - 1, z);
    pushIfEmpty(x, y, z + 1);
    pushIfEmpty(x, y, z - 1);
  }
  for (let index = 0; index < grid.cells.length; index += 1) {
    if (grid.cells[index] === VOXEL_EMPTY && !exterior[index]) {
      grid.cells[index] = VOXEL_INTERIOR;
    }
  }

  // Component-aware closing (2026-07-06, replacing an earlier
  // UNCONDITIONAL dilation that welded a chibi's adjacent legs
  // into one solid and destroyed the no-leak property): label
  // connected components of the traversable set; the largest is
  // the body. Only SATELLITE components (separate-shell eyes,
  // hair, floating accessories) get dilated — up to 3 iterations
  // — so they bridge onto the body without the body ever being
  // fattened against itself. Same-component layered clothing is
  // NOT bridged; its refinement is the weight brush's job.
  const componentOf = new Int32Array(grid.cells.length).fill(-1);
  const componentSizes: number[] = [];
  {
    const stack: number[] = [];
    for (let start = 0; start < grid.cells.length; start += 1) {
      if (grid.cells[start] === VOXEL_EMPTY || componentOf[start] !== -1) {
        continue;
      }
      const component = componentSizes.length;
      let size = 0;
      stack.push(start);
      componentOf[start] = component;
      while (stack.length > 0) {
        const index = stack.pop()!;
        size += 1;
        const x = index % dims[0];
        const y = Math.floor(index / dims[0]) % dims[1];
        const z = Math.floor(index / (dims[0] * dims[1]));
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              if (
                nx < 0 || ny < 0 || nz < 0 ||
                nx >= dims[0] || ny >= dims[1] || nz >= dims[2]
              ) {
                continue;
              }
              const neighbor = voxelIndex(grid, nx, ny, nz);
              if (
                grid.cells[neighbor] !== VOXEL_EMPTY &&
                componentOf[neighbor] === -1
              ) {
                componentOf[neighbor] = component;
                stack.push(neighbor);
              }
            }
          }
        }
      }
      componentSizes.push(size);
    }
  }
  if (componentSizes.length > 1) {
    let bodyComponent = 0;
    componentSizes.forEach((size, component) => {
      if (size > componentSizes[bodyComponent]!) bodyComponent = component;
    });
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const additions: number[] = [];
      for (let index = 0; index < grid.cells.length; index += 1) {
        if (grid.cells[index] === VOXEL_EMPTY) continue;
        if (componentOf[index] === bodyComponent) continue;
        const x = index % dims[0];
        const y = Math.floor(index / dims[0]) % dims[1];
        const z = Math.floor(index / (dims[0] * dims[1]));
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              if (
                nx < 0 || ny < 0 || nz < 0 ||
                nx >= dims[0] || ny >= dims[1] || nz >= dims[2]
              ) {
                continue;
              }
              const neighbor = voxelIndex(grid, nx, ny, nz);
              if (grid.cells[neighbor] === VOXEL_EMPTY) {
                additions.push(neighbor);
              }
            }
          }
        }
      }
      if (additions.length === 0) break;
      for (const index of additions) {
        if (grid.cells[index] === VOXEL_EMPTY) {
          grid.cells[index] = VOXEL_SURFACE;
          componentOf[index] = -2; // bridge cells: not body-labeled
        }
      }
    }
  }
  return grid;
}
