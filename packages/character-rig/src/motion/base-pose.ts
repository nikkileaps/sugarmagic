/**
 * packages/character-rig/src/motion/base-pose.ts
 *
 * Purpose: Plan 063 — the relaxed ARM base pose generated clips
 * layer their motion on top of. Extracted at vendor time from the
 * library's own Idle_Loop (mean rotation as an offset from rest;
 * see STANDARD_RIG_RELAXED_POSE), filtered to the arm chain: legs
 * and spine deliberately stay at the neutral upright contract
 * rest — the arms-down-but-not-combat-stance look. The T-pose-arms
 * bug (2026-07-07): generators emitted offsets around contract
 * rest, and the contract rest IS a T-pose.
 *
 * Status: active
 */

import { STANDARD_RIG_RELAXED_POSE } from "@sugarmagic/domain";

const ARM_BONES = [
  "DEF-shoulder.L",
  "DEF-upper_arm.L",
  "DEF-forearm.L",
  "DEF-hand.L",
  "DEF-shoulder.R",
  "DEF-upper_arm.R",
  "DEF-forearm.R",
  "DEF-hand.R"
];

export const RELAXED_ARM_POSE: Readonly<
  Record<string, readonly number[]>
> = Object.fromEntries(
  ARM_BONES.filter((name) => STANDARD_RIG_RELAXED_POSE[name]).map((name) => [
    name,
    STANDARD_RIG_RELAXED_POSE[name]!
  ])
);

/**
 * Compose the user's pose-adjust overrides (Plan 063 §063.5,
 * `MotionRecipe.basePoseOverrides`) onto the relaxed base:
 * base' = relaxed * override per bone. Bones only present in the
 * overrides get the override alone.
 */
export function composeBasePose(
  relaxed: Readonly<Record<string, readonly number[]>>,
  overrides: Readonly<Record<string, readonly number[]>> | undefined
): Readonly<Record<string, readonly number[]>> {
  if (!overrides) return relaxed;
  const merged: Record<string, readonly number[]> = { ...relaxed };
  for (const [boneName, override] of Object.entries(overrides)) {
    const base = merged[boneName];
    if (!base) {
      merged[boneName] = override;
      continue;
    }
    const [ax, ay, az, aw] = base as [number, number, number, number];
    const [bx, by, bz, bw] = override as [number, number, number, number];
    merged[boneName] = [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }
  return merged;
}
