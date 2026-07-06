/**
 * Plan 062 §062.2 — the character-rig pure core: skeleton
 * generation from landmarks and the geodesic-voxel weight
 * solver. Synthetic meshes exercise the claims the wizard's
 * quality rests on: limb locality, the two-legs-no-leak
 * property (the reason geodesic beats nearest-bone), and
 * non-watertight tolerance.
 */
import { describe, expect, it } from "vitest";
import { STANDARD_RIG } from "@sugarmagic/domain";
import {
  GeodesicVoxelWeightSolver,
  MAX_INFLUENCES,
  computeBoneSegments,
  generateStandardSkeleton,
  voxelizeMesh,
  VOXEL_INTERIOR,
  type MeshData,
  type RigLandmarks,
  type BoneSegment
} from "@sugarmagic/character-rig";

/** Axis-aligned capsule-ish tube mesh along Y between y0..y1. */
function buildTube(
  centerX: number,
  centerZ: number,
  radius: number,
  y0: number,
  y1: number,
  opts: { openEnds?: boolean } = {}
): MeshData {
  const radial = 12;
  const rings = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const y = y0 + ((y1 - y0) * ring) / rings;
    for (let seg = 0; seg < radial; seg += 1) {
      const angle = (seg / radial) * Math.PI * 2;
      positions.push(
        centerX + Math.cos(angle) * radius,
        y,
        centerZ + Math.sin(angle) * radius
      );
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let seg = 0; seg < radial; seg += 1) {
      const next = (seg + 1) % radial;
      const a = ring * radial + seg;
      const b = ring * radial + next;
      const c = (ring + 1) * radial + seg;
      const d = (ring + 1) * radial + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (!opts.openEnds) {
    // Center-fan caps.
    const bottomCenter = positions.length / 3;
    positions.push(centerX, y0, centerZ);
    const topCenter = positions.length / 3;
    positions.push(centerX, y1, centerZ);
    for (let seg = 0; seg < radial; seg += 1) {
      const next = (seg + 1) % radial;
      indices.push(bottomCenter, seg, next);
      indices.push(topCenter, rings * radial + next, rings * radial + seg);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices)
  };
}

function mergeMeshes(meshes: MeshData[]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const mesh of meshes) {
    positions.push(...mesh.positions);
    for (const index of mesh.indices) indices.push(index + offset);
    offset += mesh.positions.length / 3;
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices)
  };
}

/** Weight a named bone contributes to a vertex, post-normalize. */
function boneWeightAt(
  result: ReturnType<GeodesicVoxelWeightSolver["solve"]>,
  vertex: number,
  boneName: string
): number {
  let total = 0;
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    const jointIndex = result.joints[vertex * MAX_INFLUENCES + slot]!;
    if (result.boneOrder[jointIndex] === boneName) {
      total += result.weights[vertex * MAX_INFLUENCES + slot]!;
    }
  }
  return total;
}

/** Plausible cozy-humanoid landmarks, 1.5m tall, facing +Z. */
function sampleLandmarks(): RigLandmarks {
  return {
    pelvis: [0, 0.8, 0],
    chest: [0, 1.15, 0],
    neck: [0, 1.3, 0],
    head: [0, 1.4, 0],
    shoulderLeft: [0.22, 1.25, 0],
    elbowLeft: [0.45, 1.0, 0],
    wristLeft: [0.6, 0.8, 0],
    shoulderRight: [-0.22, 1.25, 0],
    elbowRight: [-0.45, 1.0, 0],
    wristRight: [-0.6, 0.8, 0],
    hipLeft: [0.12, 0.75, 0],
    kneeLeft: [0.13, 0.42, 0],
    ankleLeft: [0.13, 0.08, 0],
    hipRight: [-0.12, 0.75, 0],
    kneeRight: [-0.13, 0.42, 0],
    ankleRight: [-0.13, 0.08, 0]
  } as RigLandmarks;
}

describe("generateStandardSkeleton (Plan 062)", () => {
  it("produces every contract bone with resolving parents and contract rotations", () => {
    const skeleton = generateStandardSkeleton(sampleLandmarks());
    expect(skeleton.bones.length).toBe(STANDARD_RIG.bones.length);
    const byName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));
    for (const contractBone of STANDARD_RIG.bones) {
      const generated = byName.get(contractBone.name);
      expect(generated).toBeDefined();
      expect(generated!.parentName).toBe(contractBone.parentName);
      expect(generated!.localRestRotation).toEqual(contractBone.restRotation);
    }
    expect(skeleton.hipHeight).toBeCloseTo(0.8, 5);
    expect(skeleton.rigId).toBe(STANDARD_RIG.rigId);
  });

  it("places landmark-driven bones at their landmarks and derives fingers near hands", () => {
    const landmarks = sampleLandmarks();
    const skeleton = generateStandardSkeleton(landmarks);
    const byName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));
    expect(byName.get("DEF-hips")!.headPosition).toEqual(landmarks.pelvis);
    expect(byName.get("DEF-foot.L")!.headPosition).toEqual(
      landmarks.ankleLeft
    );
    // Derived finger bones land within arm's reach of the wrist.
    const wrist = landmarks.wristLeft;
    const indexFinger = byName.get("DEF-f_index.01.L")!.headPosition;
    const distance = Math.hypot(
      indexFinger[0] - wrist[0],
      indexFinger[1] - wrist[1],
      indexFinger[2] - wrist[2]
    );
    expect(distance).toBeLessThan(0.4);
  });
});

describe("GeodesicVoxelWeightSolver (Plan 062)", () => {
  const solver = new GeodesicVoxelWeightSolver();

  it("binds a two-bone tube with locality and a blended midpoint", () => {
    const mesh = buildTube(0, 0, 0.1, 0, 1);
    const segments: BoneSegment[] = [
      { boneName: "lower", start: [0, 0, 0], end: [0, 0.5, 0] },
      { boneName: "upper", start: [0, 0.5, 0], end: [0, 1, 0] }
    ];
    const result = solver.solve(mesh, segments, { resolution: 32 });
    const vertexCount = mesh.positions.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const y = mesh.positions[vertex * 3 + 1]!;
      const lower = boneWeightAt(result, vertex, "lower");
      const upper = boneWeightAt(result, vertex, "upper");
      expect(lower + upper).toBeCloseTo(1, 5);
      if (y < 0.15) expect(lower).toBeGreaterThan(0.8);
      if (y > 0.85) expect(upper).toBeGreaterThan(0.8);
    }
  });

  it("does not leak weights between two parallel legs (the geodesic property)", () => {
    // Two vertical leg tubes joined by a pelvis slab on top —
    // Euclidean distance between the legs is small, geodesic
    // distance THROUGH the body is large.
    const leftLeg = buildTube(0.15, 0, 0.07, 0, 0.7);
    const rightLeg = buildTube(-0.15, 0, 0.07, 0, 0.7);
    const pelvis = buildTube(0, 0, 0.26, 0.7, 0.95);
    const mesh = mergeMeshes([leftLeg, rightLeg, pelvis]);
    const segments: BoneSegment[] = [
      { boneName: "thigh.L", start: [0.15, 0.7, 0], end: [0.15, 0.05, 0] },
      { boneName: "thigh.R", start: [-0.15, 0.7, 0], end: [-0.15, 0.05, 0] },
      { boneName: "hips", start: [0, 0.9, 0], end: [0, 0.75, 0] }
    ];
    const result = solver.solve(mesh, segments, { resolution: 64 });
    // Sample low left-leg vertices: right thigh must contribute ~0
    // even though it is only 0.3 apart in space.
    const vertexCount = mesh.positions.length / 3;
    let checked = 0;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const x = mesh.positions[vertex * 3]!;
      const y = mesh.positions[vertex * 3 + 1]!;
      if (x > 0.1 && y < 0.3) {
        expect(boneWeightAt(result, vertex, "thigh.R")).toBeLessThan(0.05);
        expect(boneWeightAt(result, vertex, "thigh.L")).toBeGreaterThan(0.7);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("tolerates non-watertight meshes (open tube still binds, normalized)", () => {
    const mesh = buildTube(0, 0, 0.1, 0, 1, { openEnds: true });
    const segments: BoneSegment[] = [
      { boneName: "only", start: [0, 0, 0], end: [0, 1, 0] }
    ];
    const result = solver.solve(mesh, segments, { resolution: 32 });
    const vertexCount = mesh.positions.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      let sum = 0;
      for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
        const weight = result.weights[vertex * MAX_INFLUENCES + slot]!;
        expect(Number.isFinite(weight)).toBe(true);
        sum += weight;
      }
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("voxelizes a closed tube with interior cells", () => {
    const grid = voxelizeMesh(buildTube(0, 0, 0.2, 0, 1), 32);
    let interior = 0;
    for (const cell of grid.cells) {
      if (cell === VOXEL_INTERIOR) interior += 1;
    }
    expect(interior).toBeGreaterThan(0);
  });
});
