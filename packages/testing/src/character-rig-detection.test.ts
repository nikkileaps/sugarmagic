/**
 * Plan 062 §062.3 — joint detection heuristics against synthetic
 * stylized humanoids in T-pose and A-pose. Tolerances are loose
 * on purpose: detection only has to be DECENT (the wizard's
 * draggable markers are the correction loop), so these tests pin
 * "lands in the right neighborhood", not exactness.
 */
import { describe, expect, it } from "vitest";
import {
  detectRigLandmarks,
  type MeshData,
  type Vec3
} from "@sugarmagic/character-rig";

/** Append an axis-aligned box (as 12 triangles) to a mesh under construction. */
function pushBox(
  positions: number[],
  indices: number[],
  center: Vec3,
  size: Vec3
): void {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const base = positions.length / 3;
  const corners: Array<[number, number, number]> = [
    [cx - sx, cy - sy, cz - sz],
    [cx + sx, cy - sy, cz - sz],
    [cx + sx, cy + sy, cz - sz],
    [cx - sx, cy + sy, cz - sz],
    [cx - sx, cy - sy, cz + sz],
    [cx + sx, cy - sy, cz + sz],
    [cx + sx, cy + sy, cz + sz],
    [cx - sx, cy + sy, cz + sz]
  ];
  for (const corner of corners) positions.push(...corner);
  const faces = [
    [0, 1, 2, 3],
    [5, 4, 7, 6],
    [4, 0, 3, 7],
    [1, 5, 6, 2],
    [3, 2, 6, 7],
    [4, 5, 1, 0]
  ];
  for (const [a, b, c, d] of faces) {
    indices.push(base + a!, base + b!, base + c!);
    indices.push(base + a!, base + c!, base + d!);
  }
}

/**
 * Blocky 1.6m humanoid. `pose`: "t" = arms straight out along X
 * at shoulder height; "a" = arms angled ~40 degrees downward.
 */
function buildHumanoid(pose: "t" | "a"): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  // Legs: two columns, feet at y=0, crotch at 0.72.
  pushBox(positions, indices, [0.11, 0.36, 0], [0.13, 0.72, 0.16]);
  pushBox(positions, indices, [-0.11, 0.36, 0], [0.13, 0.72, 0.16]);
  // Torso: 0.72 -> 1.28.
  pushBox(positions, indices, [0, 1.0, 0], [0.4, 0.56, 0.22]);
  // Neck: 1.28 -> 1.36 (narrow).
  pushBox(positions, indices, [0, 1.32, 0], [0.1, 0.08, 0.1]);
  // Head: 1.36 -> 1.6 (wider than neck).
  pushBox(positions, indices, [0, 1.48, 0], [0.24, 0.24, 0.24]);
  // Arms from shoulder (x = +-0.2, y = 1.2), length 0.5.
  if (pose === "t") {
    pushBox(positions, indices, [0.45, 1.2, 0], [0.5, 0.1, 0.1]);
    pushBox(positions, indices, [-0.45, 1.2, 0], [0.5, 0.1, 0.1]);
  } else {
    // A-pose: three descending segments approximating a 40-degree
    // slope from the shoulder down.
    for (const side of [1, -1]) {
      pushBox(positions, indices, [side * 0.26, 1.14, 0], [0.14, 0.14, 0.1]);
      pushBox(positions, indices, [side * 0.36, 1.04, 0], [0.14, 0.14, 0.1]);
      pushBox(positions, indices, [side * 0.46, 0.94, 0], [0.14, 0.14, 0.1]);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices)
  };
}

function expectNear(actual: Vec3, expected: Vec3, tolerance: number): void {
  const distance = Math.hypot(
    actual[0] - expected[0],
    actual[1] - expected[1],
    actual[2] - expected[2]
  );
  expect(
    distance,
    `expected [${actual.join(", ")}] within ${tolerance} of [${expected.join(", ")}]`
  ).toBeLessThan(tolerance);
}

describe("detectRigLandmarks (Plan 062)", () => {
  // 1.6m character: primary joints within ~13cm (8% of height) is
  // "right neighborhood" — a drag away, not a redesign away.
  const TOLERANCE = 0.13;

  it("finds the T-pose landmarks in the right neighborhoods", () => {
    const landmarks = detectRigLandmarks(buildHumanoid("t"));
    expectNear(landmarks.pelvis, [0, 0.78, 0], TOLERANCE);
    expectNear(landmarks.neck, [0, 1.32, 0], TOLERANCE);
    expectNear(landmarks.wristLeft, [0.68, 1.2, 0], TOLERANCE);
    expectNear(landmarks.wristRight, [-0.68, 1.2, 0], TOLERANCE);
    expectNear(landmarks.ankleLeft, [0.11, 0.1, 0], TOLERANCE);
    expectNear(landmarks.ankleRight, [-0.11, 0.1, 0], TOLERANCE);
    expectNear(landmarks.hipLeft, [0.11, 0.74, 0], TOLERANCE);
    // Elbows sit between shoulder and wrist.
    expect(landmarks.elbowLeft[0]).toBeGreaterThan(landmarks.shoulderLeft[0]);
    expect(landmarks.elbowLeft[0]).toBeLessThan(landmarks.wristLeft[0]);
  });

  it("finds the A-pose landmarks (angled arms) in the right neighborhoods", () => {
    const landmarks = detectRigLandmarks(buildHumanoid("a"));
    expectNear(landmarks.pelvis, [0, 0.78, 0], TOLERANCE);
    expectNear(landmarks.wristLeft, [0.48, 0.94, 0], TOLERANCE);
    expectNear(landmarks.wristRight, [-0.48, 0.94, 0], TOLERANCE);
    // Arm chain descends in A-pose: shoulder above elbow above wrist.
    expect(landmarks.shoulderLeft[1]).toBeGreaterThan(landmarks.elbowLeft[1]);
    expect(landmarks.elbowLeft[1]).toBeGreaterThan(
      landmarks.wristLeft[1] - 0.01
    );
  });

  it("keeps left/right sides on the correct x signs", () => {
    for (const pose of ["t", "a"] as const) {
      const landmarks = detectRigLandmarks(buildHumanoid(pose));
      for (const key of [
        "shoulderLeft",
        "elbowLeft",
        "wristLeft",
        "hipLeft",
        "kneeLeft",
        "ankleLeft"
      ] as const) {
        expect(landmarks[key][0], `${pose}:${key}`).toBeGreaterThan(0);
      }
      for (const key of [
        "shoulderRight",
        "wristRight",
        "hipRight",
        "ankleRight"
      ] as const) {
        expect(landmarks[key][0], `${pose}:${key}`).toBeLessThan(0);
      }
    }
  });

  it("feeds detection output straight into skeleton generation", async () => {
    const { generateStandardSkeleton } = await import(
      "@sugarmagic/character-rig"
    );
    const skeleton = generateStandardSkeleton(
      detectRigLandmarks(buildHumanoid("t"))
    );
    expect(skeleton.bones.length).toBe(53);
    expect(skeleton.hipHeight).toBeGreaterThan(0.6);
    expect(skeleton.hipHeight).toBeLessThan(1.0);
  });
});
