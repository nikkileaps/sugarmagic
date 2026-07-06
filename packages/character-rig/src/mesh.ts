/**
 * packages/character-rig/src/mesh.ts
 *
 * Purpose: Plan 062 §062.2 — the plain typed-array mesh struct
 * the rig core operates on. Deliberately dumb: positions +
 * triangle indices, nothing renderer-flavored. Adapters on the
 * CALLER side (Studio) convert three.js BufferGeometry to/from
 * this shape; three never appears inside this package.
 *
 * Status: active
 */

export interface MeshData {
  /** xyz triples, world/model space (character upright +Y, facing +Z). */
  positions: Float32Array;
  /** Triangle vertex indices, 3 per face. */
  indices: Uint32Array;
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function computeMeshBounds(mesh: MeshData): MeshBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[i + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * Vertex adjacency over shared triangle edges — the neighborhood
 * used by weight smoothing.
 */
export function buildVertexAdjacency(mesh: MeshData): Array<Set<number>> {
  const vertexCount = mesh.positions.length / 3;
  const adjacency: Array<Set<number>> = Array.from(
    { length: vertexCount },
    () => new Set<number>()
  );
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]!;
    const b = mesh.indices[i + 1]!;
    const c = mesh.indices[i + 2]!;
    adjacency[a]!.add(b).add(c);
    adjacency[b]!.add(a).add(c);
    adjacency[c]!.add(a).add(b);
  }
  return adjacency;
}
