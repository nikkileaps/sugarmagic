/**
 * packages/domain/src/standard-rig/tail-extension.ts
 *
 * Purpose: Plan 064 — the OPTIONAL tail extension to the standard
 * rig: three bones chained off DEF-hips. HAND-AUTHORED, not
 * generated: the vendored library rig has no tail, so this
 * extension is ours — the rest pose is a back-and-up arc
 * (character faces +Z; tail exits at -Z low and curls steeply
 * toward vertical — squirrel-upright is the design-center default;
 * per-character stance lives in pose-adjust overrides), derived numerically against the
 * contract's hips frame (see the plan's 064.1 derivation) and
 * verified by the contract tests.
 *
 * Compatibility rule (the schema-v2 story): tail bones are
 * ADDITIVE and OPTIONAL. Name-based clip binding degrades
 * gracefully in both directions — tail-less characters ignore
 * tail tracks; tail-less clips leave tail bones at rest. No
 * existing content migrates.
 *
 * Status: active
 */

import type { StandardRigBone } from "./index";

export const STANDARD_RIG_TAIL_BONES: readonly StandardRigBone[] = [
  {
    name: "DEF-tail.001",
    parentName: "DEF-hips",
    restPosition: [0, -0.073384, -0.084349],
    restRotation: [-0.581317, 0, 0, 0.813677],
    restScale: [1, 1, 1]
  },
  {
    name: "DEF-tail.002",
    parentName: "DEF-tail.001",
    restPosition: [0, 0.16, 0],
    restRotation: [0.300146, 0, 0, 0.953893],
    restScale: [1, 1, 1]
  },
  {
    name: "DEF-tail.003",
    parentName: "DEF-tail.002",
    restPosition: [0, 0.16, 0],
    restRotation: [0.168508, 0, 0, 0.9857],
    restScale: [1, 1, 1]
  }
];

/** Wizard tail landmarks -> the bone whose HEAD sits there. */
export const STANDARD_RIG_TAIL_LANDMARK_BONES: Readonly<
  Record<string, string>
> = {
  tailBase: "DEF-tail.001",
  tailMid: "DEF-tail.002",
  tailTip: "DEF-tail.003"
};

const TAIL_NAME_SET = new Set(
  STANDARD_RIG_TAIL_BONES.map((bone) => bone.name)
);

export function isStandardRigTailBoneName(name: string): boolean {
  return TAIL_NAME_SET.has(name);
}
