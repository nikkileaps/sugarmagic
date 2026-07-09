/**
 * Plan 062 §062.8 — pure weight-painting ops: renormalization,
 * 4-influence cap, brush falloff, smooth mode.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_REGION_LABELS,
  applyBrushStroke,
  bonesOfRegion,
  resolveRegionWeights,
  shrinkwrapWeights,
  assignVerticesToBone,
  boneWeightOfVertex,
  computeBodyRegions,
  buildVertexAdjacency,
  mirrorWeights,
  setBoneWeightAtVertex,
  MAX_INFLUENCES,
  type MeshData,
  type SkinWeights
} from "@sugarmagic/character-rig";

function makeWeights(vertexCount: number, boneOrder: string[]): SkinWeights {
  const joints = new Uint16Array(vertexCount * MAX_INFLUENCES);
  const weights = new Float32Array(vertexCount * MAX_INFLUENCES);
  for (let v = 0; v < vertexCount; v += 1) {
    joints[v * MAX_INFLUENCES] = 0;
    weights[v * MAX_INFLUENCES] = 1;
  }
  return { boneOrder, joints, weights };
}

function weightSum(w: SkinWeights, vertex: number): number {
  let sum = 0;
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    sum += w.weights[vertex * MAX_INFLUENCES + slot]!;
  }
  return sum;
}

describe("weight painting ops (Plan 062)", () => {
  it("setBoneWeightAtVertex renormalizes and preserves the cap", () => {
    const w = makeWeights(1, ["a", "b", "c", "d", "e"]);
    setBoneWeightAtVertex(w, 0, 1, 0.6);
    expect(boneWeightOfVertex(w, 0, 1)).toBeCloseTo(0.6, 5);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(0.4, 5);
    expect(weightSum(w, 0)).toBeCloseTo(1, 5);
    // Paint three more bones — cap keeps strongest four, still
    // normalized.
    setBoneWeightAtVertex(w, 0, 2, 0.3);
    setBoneWeightAtVertex(w, 0, 3, 0.2);
    setBoneWeightAtVertex(w, 0, 4, 0.1);
    expect(weightSum(w, 0)).toBeCloseTo(1, 5);
  });

  it("painting to zero leaves the vertex bound to its next-strongest bone", () => {
    const w = makeWeights(1, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 1, 0.4);
    setBoneWeightAtVertex(w, 0, 1, 0);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
    expect(weightSum(w, 0)).toBeCloseTo(1, 5);
  });

  it("brush strokes fall off with distance and only touch the radius", () => {
    // 3 vertices along x: 0, 0.5 (inside), 2 (outside).
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 0.5, 0, 0, 2, 0, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const w = makeWeights(3, ["a", "b"]);
    const affected = applyBrushStroke(mesh, w, {
      center: [0, 0, 0],
      radius: 1,
      boneColumn: 1,
      strength: 1,
      mode: "add"
    });
    expect(affected).toEqual([0, 1]);
    expect(boneWeightOfVertex(w, 0, 1)).toBeCloseTo(1, 4);
    const midFalloff = boneWeightOfVertex(w, 1, 1);
    expect(midFalloff).toBeGreaterThan(0.1);
    expect(midFalloff).toBeLessThan(0.9);
    expect(boneWeightOfVertex(w, 2, 1)).toBe(0);
  });

  it("smooth mode pulls a spike toward its neighbors", () => {
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const w = makeWeights(3, ["a", "b"]);
    setBoneWeightAtVertex(w, 1, 1, 0.9); // spike (a:0.1, b:0.9)
    const adjacency = buildVertexAdjacency(mesh);
    applyBrushStroke(
      mesh,
      w,
      { center: [0.1, 0, 0], radius: 1, boneColumn: 1, strength: 1, mode: "smooth" },
      adjacency
    );
    const smoothed = boneWeightOfVertex(w, 1, 1);
    expect(smoothed).toBeLessThan(0.9);
    expect(weightSum(w, 1)).toBeCloseTo(1, 5);
  });

  it("subtract on a sole-influence vertex borrows the receiving bone from neighbors", () => {
    // Three vertices in a line; middle is 100% bone 1 (a stray
    // from a fill sweep), neighbors are 100% bone 0. Subtracting
    // bone 1 at the middle must bleed weight to bone 0 instead of
    // renormalizing back to 1.
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const w = makeWeights(3, ["a", "b"]);
    w.joints[1 * MAX_INFLUENCES] = 1;
    w.weights[1 * MAX_INFLUENCES] = 1;
    const adjacency = buildVertexAdjacency(mesh);
    applyBrushStroke(
      mesh,
      w,
      {
        center: [0.1, 0, 0],
        radius: 0.05,
        boneColumn: 1,
        strength: 0.5,
        mode: "subtract"
      },
      adjacency
    );
    expect(boneWeightOfVertex(w, 1, 1)).toBeLessThan(1);
    expect(boneWeightOfVertex(w, 1, 0)).toBeGreaterThan(0);
    expect(weightSum(w, 1)).toBeCloseTo(1, 5);
  });

  it("subtract works deep inside a filled region via territorial BFS", () => {
    // A strip of 6 vertices, chained by triangles. Vertices 1-5
    // are 100% bone 1 (a Fill sweep); only vertex 0 carries bone
    // 0. Subtracting at vertex 3 (no immediate neighbor with
    // another influence) must find bone 0 by walking the mesh.
    const positions = new Float32Array(18);
    for (let i = 0; i < 6; i += 1) positions[i * 3] = i * 0.1;
    const indices = new Uint32Array([
      0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5
    ]);
    const mesh: MeshData = { positions, indices };
    const w = makeWeights(6, ["a", "b"]);
    for (let v = 1; v < 6; v += 1) {
      w.joints[v * MAX_INFLUENCES] = 1;
      w.weights[v * MAX_INFLUENCES] = 1;
    }
    const adjacency = buildVertexAdjacency(mesh);
    applyBrushStroke(
      mesh,
      w,
      {
        center: [0.3, 0, 0],
        radius: 0.05,
        boneColumn: 1,
        strength: 0.5,
        mode: "subtract"
      },
      adjacency
    );
    expect(boneWeightOfVertex(w, 3, 1)).toBeLessThan(1);
    expect(boneWeightOfVertex(w, 3, 0)).toBeGreaterThan(0);
    expect(weightSum(w, 3)).toBeCloseTo(1, 5);
  });

  it("a sole-influence vertex stays fully bound (normalization has nowhere else to go)", () => {
    // DCC-standard: reducing the only influence renormalizes back
    // to 1 — matches Blender's auto-normalize behavior.
    const w = makeWeights(1, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 0, 0.3);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
  });
});

describe("mirrorWeights (Plan 062)", () => {
  it("copies left weights onto mirrored right vertices with L/R bones swapped", () => {
    // Two mirrored pairs across x=0 plus a center vertex.
    const mesh: MeshData = {
      positions: new Float32Array([
        0.5, 1, 0, -0.5, 1, 0, 0.3, 0.2, 0.1, -0.3, 0.2, 0.1, 0, 0.5, 0
      ]),
      indices: new Uint32Array([0, 1, 2, 2, 3, 4])
    };
    const w = makeWeights(5, ["DEF-upper_arm.L", "DEF-upper_arm.R", "DEF-hips"]);
    // Paint the LEFT side: v0 arm.L 0.7 / hips 0.3, v2 arm.L 1.
    setBoneWeightAtVertex(w, 0, 2, 0.3);
    setBoneWeightAtVertex(w, 2, 0, 1);
    // Right side starts all bone 0 (arm.L — wrong on purpose).
    const result = mirrorWeights(mesh, w, { direction: "leftToRight" });
    expect(result.affected.sort()).toEqual([1, 3]);
    expect(result.unmatched).toBe(0);
    // v1 mirrors v0: arm.R 0.7, hips 0.3.
    expect(boneWeightOfVertex(w, 1, 1)).toBeCloseTo(0.7, 5);
    expect(boneWeightOfVertex(w, 1, 2)).toBeCloseTo(0.3, 5);
    // v3 mirrors v2: arm.R 1.
    expect(boneWeightOfVertex(w, 3, 1)).toBeCloseTo(1, 5);
    // Center vertex untouched.
    expect(boneWeightOfVertex(w, 4, 0)).toBeCloseTo(1, 5);
  });

  it("leaves right-side vertices without a mirror twin untouched", () => {
    const mesh: MeshData = {
      positions: new Float32Array([0.5, 1, 0, -0.5, 3, 0]),
      indices: new Uint32Array([0, 1, 0])
    };
    const w = makeWeights(2, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 1, 1);
    const result = mirrorWeights(mesh, w, { direction: "leftToRight" });
    expect(result.affected).toEqual([]);
    expect(result.unmatched).toBe(1);
    expect(boneWeightOfVertex(w, 1, 0)).toBeCloseTo(1, 5);
  });
});

describe("assignVerticesToBone (Plan 064)", () => {
  it("rigidly assigns an explicit selection, leaving others alone", () => {
    const w = makeWeights(4, ["a", "b"]);
    assignVerticesToBone(w, [1, 3], 1);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
    expect(boneWeightOfVertex(w, 1, 1)).toBeCloseTo(1, 5);
    expect(boneWeightOfVertex(w, 2, 0)).toBeCloseTo(1, 5);
    expect(boneWeightOfVertex(w, 3, 1)).toBeCloseTo(1, 5);
  });
});

describe("computeBodyRegions (Plan 064)", () => {
  it("classifies vertices by dominant bone group; tail only when present", () => {
    const boneOrder = [
      "DEF-hips",
      "DEF-head",
      "DEF-upper_arm.L",
      "DEF-thigh.R",
      "DEF-tail.002"
    ];
    const w = makeWeights(5, boneOrder);
    // v0 hips (default), v1 head, v2 left arm, v3 right leg, v4 tail.
    for (let v = 1; v < 5; v += 1) {
      w.joints[v * MAX_INFLUENCES] = v;
      w.weights[v * MAX_INFLUENCES] = 1;
    }
    const regions = computeBodyRegions(
      { joints: w.joints, weights: w.weights },
      boneOrder
    );
    expect(regions.get("torso")).toEqual(new Set([0]));
    expect(regions.get("head")).toEqual(new Set([1]));
    expect(regions.get("leftArm")).toEqual(new Set([2]));
    expect(regions.get("rightLeg")).toEqual(new Set([3]));
    expect(regions.get("tail")).toEqual(new Set([4]));
    expect(BODY_REGION_LABELS.leftArm).toBe("Left Arm");
    // Mixed vertex: dominant GROUP wins (0.3 head + 0.3 neck-ish
    // would beat 0.4 hips if grouped — here 0.6 arm beats 0.4 hips).
    const mixed = makeWeights(1, boneOrder);
    mixed.joints.set([0, 2, 0, 0], 0);
    mixed.weights.set([0.4, 0.6, 0, 0], 0);
    const mixedRegions = computeBodyRegions(
      { joints: mixed.joints, weights: mixed.weights },
      boneOrder
    );
    expect(mixedRegions.get("leftArm")).toEqual(new Set([0]));
  });

  it("coincident seam duplicates classify into the SAME region", () => {
    const boneOrder = ["DEF-hips", "DEF-tail.002"];
    const w = makeWeights(2, boneOrder);
    // Twin 0: 100% tail. Twin 1: 100% hips. Same position.
    w.joints[0] = 1;
    w.weights[0] = 1;
    const positions = new Float32Array([0.04, 1.05, -0.11, 0.04, 1.05, -0.11]);
    const regions = computeBodyRegions(
      { joints: w.joints, weights: w.weights },
      boneOrder,
      positions
    );
    // Joint vote: both land in ONE region (whichever wins), never split.
    const tail = regions.get("tail") ?? new Set();
    const torso = regions.get("torso") ?? new Set();
    expect(tail.size === 2 || torso.size === 2).toBe(true);
    expect(tail.size === 1 || torso.size === 1).toBe(false);
  });
});

describe("resolveRegionWeights (Plan 064)", () => {
  it("maps region ids to their bone chains", () => {
    const boneOrder = [
      "DEF-hips",
      "DEF-spine.002",
      "DEF-shoulder.L",
      "DEF-upper_arm.L",
      "DEF-forearm.L",
      "DEF-hand.L",
      "DEF-thigh.L",
      "DEF-tail.001"
    ];
    expect(bonesOfRegion(boneOrder, "leftArm")).toEqual(
      new Set(["DEF-shoulder.L", "DEF-upper_arm.L", "DEF-forearm.L", "DEF-hand.L"])
    );
    expect(bonesOfRegion(boneOrder, "leftLeg")).toEqual(new Set(["DEF-thigh.L"]));
    expect(bonesOfRegion(boneOrder, "tail")).toEqual(new Set(["DEF-tail.001"]));
    expect(bonesOfRegion(boneOrder, "torso")).toEqual(
      new Set(["DEF-hips", "DEF-spine.002"])
    );
  });

  it("re-solves a limb tube: graduated along the chain, feathered at the edge", () => {
    // A horizontal tube (the "sleeve") from x=0 to x=1, made of
    // rings so it has real volume for the voxel solve.
    const positions: number[] = [];
    const indices: number[] = [];
    const RINGS = 21, SIDES = 8, R = 0.08;
    for (let ring = 0; ring < RINGS; ring += 1) {
      const x = ring / (RINGS - 1);
      for (let side = 0; side < SIDES; side += 1) {
        const angle = (side / SIDES) * Math.PI * 2;
        positions.push(x, Math.cos(angle) * R, Math.sin(angle) * R);
      }
    }
    for (let ring = 0; ring < RINGS - 1; ring += 1) {
      for (let side = 0; side < SIDES; side += 1) {
        const a = ring * SIDES + side;
        const b = ring * SIDES + ((side + 1) % SIDES);
        const c = (ring + 1) * SIDES + side;
        const d = (ring + 1) * SIDES + ((side + 1) % SIDES);
        indices.push(a, b, c, b, d, c);
      }
    }
    const mesh: MeshData = {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices)
    };
    const vertexCount = positions.length / 3;
    const boneOrder = ["DEF-spine.002", "DEF-upper_arm.L", "DEF-forearm.L"];
    const w = makeWeights(vertexCount, boneOrder); // all 100% spine (col 0)
    // Region: everything past x=0.2 is "arm".
    const regionSet = new Set<number>();
    for (let v = 0; v < vertexCount; v += 1) {
      if (mesh.positions[v * 3]! > 0.2) regionSet.add(v);
    }
    const segments = [
      { boneName: "DEF-upper_arm.L", start: [0.2, 0, 0] as const, end: [0.6, 0, 0] as const },
      { boneName: "DEF-forearm.L", start: [0.6, 0, 0] as const, end: [1, 0, 0] as const },
      { boneName: "DEF-spine.002", start: [0, 0, 0] as const, end: [0.2, 0, 0] as const }
    ];
    const affected = resolveRegionWeights(
      mesh, w, segments as never, regionSet, "leftArm", { resolution: 32 }
    );
    expect(affected.length).toBe(regionSet.size);
    // Deep in the forearm zone: forearm dominates.
    const tip = vertexCount - 1;
    expect(boneWeightOfVertex(w, tip, 2)).toBeGreaterThan(0.6);
    // Mid upper-arm zone: upper arm dominates.
    let mid = -1;
    for (let v = 0; v < vertexCount; v += 1) {
      if (Math.abs(mesh.positions[v * 3]! - 0.4) < 0.03) { mid = v; break; }
    }
    expect(boneWeightOfVertex(w, mid, 1)).toBeGreaterThan(0.5);
    // Boundary feather: a vertex just inside the region edge keeps
    // meaningful spine weight (blend, not a hard cut).
    let edge = -1;
    for (const v of regionSet) {
      if (Math.abs(mesh.positions[v * 3]! - 0.25) < 0.03) { edge = v; break; }
    }
    expect(boneWeightOfVertex(w, edge, 0)).toBeGreaterThan(0.15);
    // Outside the region untouched: still 100% spine.
    let outside = -1;
    for (let v = 0; v < vertexCount; v += 1) {
      if (!regionSet.has(v)) { outside = v; break; }
    }
    expect(boneWeightOfVertex(w, outside, 0)).toBeCloseTo(1, 5);
  });
});

describe("shrinkwrapWeights (Plan 064)", () => {
  /** Tube of rings along X from x0 to x1 at radius r. */
  function tube(x0: number, x1: number, r: number, rings: number, sides: number) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let ring = 0; ring < rings; ring += 1) {
      const x = x0 + ((x1 - x0) * ring) / (rings - 1);
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        positions.push(x, Math.cos(angle) * r, Math.sin(angle) * r);
      }
    }
    for (let ring = 0; ring < rings - 1; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const a = ring * sides + side;
        const b = ring * sides + ((side + 1) % sides);
        const c = (ring + 1) * sides + side;
        const d = (ring + 1) * sides + ((side + 1) % sides);
        indices.push(a, b, c, b, d, c);
      }
    }
    return { positions, indices };
  }

  it("confidently copies where close, inpaints where far, gates by distance", () => {
    // Source "arm": tube x 0..1, r=0.08, graduated weights: bone 0
    // (upper) fades to bone 1 (fore) along x.
    const arm = tube(0, 1, 0.08, 21, 8);
    // Target "sleeve": tube x 0..1, r=0.12 — close to the arm
    // everywhere EXCEPT a bulge: rings past x=0.8 at r=0.5
    // (a flap far from the body).
    const sleeve = tube(0, 1, 0.12, 21, 8);
    for (let ring = 17; ring < 21; ring += 1) {
      for (let side = 0; side < 8; side += 1) {
        const v = ring * 8 + side;
        const y = sleeve.positions[v * 3 + 1]!;
        const z = sleeve.positions[v * 3 + 2]!;
        const scale = 0.5 / 0.12;
        sleeve.positions[v * 3 + 1] = y * scale;
        sleeve.positions[v * 3 + 2] = z * scale;
      }
    }
    const armCount = arm.positions.length / 3;
    const positions = new Float32Array([...arm.positions, ...sleeve.positions]);
    const indices = new Uint32Array([
      ...arm.indices,
      ...sleeve.indices.map((index) => index + armCount)
    ]);
    const mesh: MeshData = { positions, indices };
    const total = positions.length / 3;
    const w = makeWeights(total, ["upper", "fore", "junk"]);
    // Arm weights: graduated 0->1 along x.
    for (let v = 0; v < armCount; v += 1) {
      const t = positions[v * 3]!;
      w.joints[v * MAX_INFLUENCES] = 0;
      w.weights[v * MAX_INFLUENCES] = 1 - t;
      w.joints[v * MAX_INFLUENCES + 1] = 1;
      w.weights[v * MAX_INFLUENCES + 1] = t;
    }
    // Sleeve starts 100% junk (column 2).
    for (let v = armCount; v < total; v += 1) {
      w.joints[v * MAX_INFLUENCES] = 2;
      w.weights[v * MAX_INFLUENCES] = 1;
    }
    const result = shrinkwrapWeights(
      mesh,
      w,
      { start: armCount, end: total },
      { start: 0, end: armCount },
      { distanceThreshold: 0.1 }
    );
    // Most of the sleeve matched directly; the bulge inpainted.
    expect(result.matched).toBeGreaterThan(100);
    expect(result.inpainted).toBeGreaterThan(10);
    expect(result.untouched).toBe(0);
    // Near sleeve start: upper-dominated. Near x=0.75: fore-dominated.
    const sleeveVertAt = (x: number) => {
      for (let v = armCount; v < total; v += 1) {
        if (Math.abs(positions[v * 3]! - x) < 0.03 && Math.hypot(positions[v*3+1]!, positions[v*3+2]!) < 0.2) return v;
      }
      return -1;
    };
    expect(boneWeightOfVertex(w, sleeveVertAt(0.05), 0)).toBeGreaterThan(0.8);
    expect(boneWeightOfVertex(w, sleeveVertAt(0.75), 1)).toBeGreaterThan(0.6);
    // The far bulge got INPAINTED plausible arm weights (junk gone,
    // fore-dominant since it hangs off the wrist end).
    let bulge = -1;
    for (let v = armCount; v < total; v += 1) {
      if (Math.hypot(positions[v*3+1]!, positions[v*3+2]!) > 0.4) { bulge = v; break; }
    }
    expect(boneWeightOfVertex(w, bulge, 2)).toBeLessThan(0.05);
    expect(
      boneWeightOfVertex(w, bulge, 1) + boneWeightOfVertex(w, bulge, 0)
    ).toBeGreaterThan(0.9);
    // Source untouched.
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
  });
});
