/**
 * Plan 062 §062.2 — the character-rig pure core: skeleton
 * generation from landmarks and the geodesic-voxel weight
 * solver. Synthetic meshes exercise the claims the wizard's
 * quality rests on: limb locality, the two-legs-no-leak
 * property (the reason geodesic beats nearest-bone), and
 * non-watertight tolerance.
 */
import { describe, expect, it } from "vitest";
import { STANDARD_RIG_CORE, STANDARD_RIG_CORE_WITH_TAIL } from "@sugarmagic/domain";
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
  it("tail landmarks grow the skeleton by the aligned tail chain (Plan 064)", () => {
    const landmarks = {
      ...sampleLandmarks(),
      tailBase: [0, 0.7, -0.15] as const,
      tailMid: [0, 0.8, -0.35] as const,
      tailTip: [0, 1.05, -0.45] as const
    };
    const skeleton = generateStandardSkeleton(landmarks);
    expect(skeleton.bones.length).toBe(STANDARD_RIG_CORE_WITH_TAIL.bones.length);
    const byName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));
    expect(byName.get("DEF-tail.001")!.headPosition).toEqual([0, 0.7, -0.15]);
    expect(byName.get("DEF-tail.002")!.headPosition).toEqual([0, 0.8, -0.35]);
    expect(byName.get("DEF-tail.003")!.headPosition).toEqual([0, 1.05, -0.45]);
    expect(byName.get("DEF-tail.001")!.parentName).toBe("DEF-hips");
    // Rest alignment: tail.001's +Y aims at tail.002's head.
    const world = new Map<string, [number, number, number, number]>();
    const mul = (
      a: [number, number, number, number],
      b: [number, number, number, number]
    ): [number, number, number, number] => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    for (const bone of skeleton.bones) {
      const parent = bone.parentName
        ? world.get(bone.parentName)!
        : ([0, 0, 0, 1] as [number, number, number, number]);
      world.set(
        bone.name,
        mul(parent, bone.localRestRotation as [number, number, number, number])
      );
    }
    const [x, y, z, w] = world.get("DEF-tail.001")!;
    const boneY = [2 * (x * y + z * w) * 0 + 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    const dir = [0, 0.1, -0.2];
    const len = Math.hypot(...dir);
    const dot =
      (boneY[0]! * dir[0]!) / len +
      (boneY[1]! * dir[1]!) / len +
      (boneY[2]! * dir[2]!) / len;
    expect(dot).toBeGreaterThan(0.999);
    // Segments include the tail (weights bind it).
    const segments = computeBoneSegments(skeleton);
    expect(segments.some((segment) => segment.boneName === "DEF-tail.003")).toBe(true);
    // Tail-less landmarks unchanged: still 23 bones.
    expect(generateStandardSkeleton(sampleLandmarks()).bones.length).toBe(23);
  });

  it("produces every contract bone, rest-aligned to the character's limb directions", () => {
    const skeleton = generateStandardSkeleton(sampleLandmarks());
    // Core set only (2026-07-06): no finger bones on wizard rigs.
    expect(skeleton.bones.length).toBe(STANDARD_RIG_CORE.bones.length);
    expect(skeleton.bones.length).toBe(23);
    const byName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));
    for (const contractBone of STANDARD_RIG_CORE.bones) {
      const generated = byName.get(contractBone.name);
      expect(generated).toBeDefined();
      expect(generated!.parentName).toBe(contractBone.parentName);
    }
    // Rest-pose ALIGNMENT invariant (2026-07-06): each bone's
    // composed world +Y points at its primary child — the
    // character's actual limb direction, not the library rig's.
    const world = new Map<string, [number, number, number, number]>();
    const mulQuat = (
      a: [number, number, number, number],
      b: [number, number, number, number]
    ): [number, number, number, number] => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    const rotateY = (q: [number, number, number, number]) => {
      const [x, y, z, w] = q;
      return [
        2 * (x * y - w * z),
        1 - 2 * (x * x + z * z),
        2 * (y * z + w * x)
      ];
    };
    for (const bone of skeleton.bones) {
      const parent = bone.parentName ? world.get(bone.parentName)! : ([0, 0, 0, 1] as [number, number, number, number]);
      world.set(bone.name, mulQuat(parent, bone.localRestRotation as [number, number, number, number]));
    }
    // Check the left arm chain: upper arm +Y aims from shoulder
    // landmark toward the elbow landmark.
    const landmarks = sampleLandmarks();
    const upperArmY = rotateY(world.get("DEF-upper_arm.L")!);
    const armDir = [
      landmarks.elbowLeft[0] - landmarks.shoulderLeft[0],
      landmarks.elbowLeft[1] - landmarks.shoulderLeft[1],
      landmarks.elbowLeft[2] - landmarks.shoulderLeft[2]
    ];
    const armLen = Math.hypot(armDir[0]!, armDir[1]!, armDir[2]!);
    const dot =
      (upperArmY[0]! * armDir[0]!) / armLen +
      (upperArmY[1]! * armDir[1]!) / armLen +
      (upperArmY[2]! * armDir[2]!) / armLen;
    expect(dot).toBeGreaterThan(0.999);
    expect(skeleton.hipHeight).toBeCloseTo(0.8, 5);
    expect(skeleton.rigId).toBe(STANDARD_RIG_CORE.rigId);
  });

  it("places landmark-driven bones at their landmarks and derives fingers near hands", () => {
    const landmarks = sampleLandmarks();
    const skeleton = generateStandardSkeleton(landmarks);
    const byName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));
    expect(byName.get("DEF-hips")!.headPosition).toEqual(landmarks.pelvis);
    expect(byName.get("DEF-foot.L")!.headPosition).toEqual(
      landmarks.ankleLeft
    );
    // No finger bones on wizard skeletons (core set).
    expect(byName.has("DEF-f_index.01.L")).toBe(false);
    // Toes derive below-and-forward of the ankles.
    const toe = byName.get("DEF-toe.L")!.headPosition;
    expect(toe[1]).toBeLessThan(landmarks.ankleLeft[1] + 0.1);
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

  it("binds disconnected shells (jacket over body) to nearby bones, not the first bone", () => {
    // 2026-07-06 regression — layered stylized characters ship
    // clothes/eyes as separate mesh pieces with no voxel path to
    // the body. Those vertices used to collapse onto boneOrder[0]
    // (hips) and crumple under animation.
    const body = buildTube(0, 0, 0.09, 0, 1);
    // "Sleeve" shell floating around the upper half, clearly
    // disconnected (radial gap > voxel size at res 32).
    const sleeve = buildTube(0.5, 0, 0.05, 0.55, 0.95, { openEnds: true });
    const mesh = mergeMeshes([body, sleeve]);
    const segments: BoneSegment[] = [
      { boneName: "lower", start: [0, 0, 0], end: [0, 0.5, 0] },
      { boneName: "upper", start: [0, 0.5, 0], end: [0, 1, 0] },
      { boneName: "arm", start: [0.3, 0.9, 0], end: [0.55, 0.6, 0] }
    ];
    const result = solver.solve(mesh, segments, { resolution: 32 });
    const bodyVertexCount = body.positions.length / 3;
    const vertexCount = mesh.positions.length / 3;
    let checked = 0;
    for (let vertex = bodyVertexCount; vertex < vertexCount; vertex += 1) {
      // Sleeve vertices follow the ARM (their nearest segment),
      // and never the lower-body bone.
      expect(boneWeightAt(result, vertex, "arm")).toBeGreaterThan(0.5);
      expect(boneWeightAt(result, vertex, "lower")).toBeLessThan(0.1);
      let sum = 0;
      for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
        sum += result.weights[vertex * MAX_INFLUENCES + slot]!;
      }
      expect(sum).toBeCloseTo(1, 5);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
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
