/**
 * packages/character-rig/src/index.ts
 *
 * Purpose: Plan 062 — the Character Wizard's pure algorithm
 * core. THREE-free, DOM-free, worker-safe; depends on
 * @sugarmagic/domain only (the standard-rig contract). Callers
 * (Studio) adapt three.js geometry to/from the plain structs at
 * their edge — three never appears here.
 *
 * Pipeline stages exported here (Plan 062 architecture):
 *   landmarks -> generateStandardSkeleton -> computeBoneSegments
 *   -> WeightSolver.solve (GeodesicVoxelWeightSolver)
 * Joint detection (062.3) and GLB assembly (062.4, io) join the
 * pipeline from their own homes.
 *
 * Status: active
 */

export {
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Lerp,
  vec3Length,
  vec3Distance,
  quatMultiply,
  quatConjugate,
  quatRotateVec3,
  QUAT_IDENTITY,
  VEC3_ZERO,
  type Vec3,
  type Quat
} from "./math";
export {
  computeMeshBounds,
  buildVertexAdjacency,
  type MeshData,
  type MeshBounds
} from "./mesh";
export {
  generateStandardSkeleton,
  computeBoneSegments,
  type RigLandmarks,
  type GeneratedBone,
  type GeneratedSkeleton,
  type BoneSegment
} from "./skeleton";
export {
  voxelizeMesh,
  worldToVoxel,
  voxelIndex,
  VOXEL_EMPTY,
  VOXEL_SURFACE,
  VOXEL_INTERIOR,
  type VoxelGrid
} from "./voxel";
export {
  GeodesicVoxelWeightSolver,
  MAX_INFLUENCES,
  type WeightSolver,
  type WeightSolveOptions,
  type SkinWeights
} from "./weights";
export { detectRigLandmarks } from "./detection";
