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
