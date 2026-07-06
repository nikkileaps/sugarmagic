/**
 * packages/domain/src/standard-rig/index.ts
 *
 * Purpose: Plan 062 §062.1 — the Character Wizard's STANDARD RIG
 * CONTRACT. Every wizard-generated character wears exactly this
 * skeleton (bone names, hierarchy, rest pose), which is what lets
 * one animation library drive every character forever with no
 * retargeting. The bone set is the Quaternius universal humanoid
 * rig (53 Rigify-style DEF- bones), so the vendored CC0 clips
 * (vendor/quaternius-ual/) resolve against it by construction —
 * `rig-data.ts` is GENERATED from the same pinned source as the
 * clips by scripts/vendor-character-clips.mjs.
 *
 * This contract is a single source of truth with teeth: every
 * animation ever shipped targets these bone names. It changes
 * ONLY with a `STANDARD_RIG_SCHEMA_VERSION` bump and an explicit
 * migration story for existing generated characters.
 *
 * Landmarks: the wizard's 16 user-confirmed joint positions
 * drive the PRIMARY bones; the remaining bones (fingers, toes,
 * spine intermediates) are DERIVED procedurally from them at
 * skeleton-generation time (packages/character-rig, Plan 062
 * §062.2). The contract records which is which.
 *
 * Status: active
 */

import { STANDARD_RIG_BONES } from "./rig-data";

export const STANDARD_RIG_SCHEMA_VERSION = 1;

export const STANDARD_RIG_ID = "sugarmagic-humanoid-v1";

export interface StandardRigBone {
  /** glTF node name — the identity animation tracks target. */
  name: string;
  /** Parent bone name, or null for the root. */
  parentName: string | null;
  restPosition: number[];
  /** Quaternion [x, y, z, w]. */
  restRotation: number[];
  restScale: number[];
}

/**
 * The wizard's user-confirmable landmarks mapped to the primary
 * bones they position. Every other bone in the contract derives
 * from these procedurally.
 */
export const STANDARD_RIG_LANDMARK_BONES: Readonly<Record<string, string>> = {
  pelvis: "DEF-hips",
  chest: "DEF-spine.003",
  neck: "DEF-neck",
  head: "DEF-head",
  shoulderLeft: "DEF-shoulder.L",
  elbowLeft: "DEF-forearm.L",
  wristLeft: "DEF-hand.L",
  shoulderRight: "DEF-shoulder.R",
  elbowRight: "DEF-forearm.R",
  wristRight: "DEF-hand.R",
  hipLeft: "DEF-thigh.L",
  kneeLeft: "DEF-shin.L",
  ankleLeft: "DEF-foot.L",
  hipRight: "DEF-thigh.R",
  kneeRight: "DEF-shin.R",
  ankleRight: "DEF-foot.R"
};

export interface StandardRigDefinition {
  rigId: string;
  rigSchemaVersion: number;
  bones: readonly StandardRigBone[];
}

export const STANDARD_RIG: StandardRigDefinition = {
  rigId: STANDARD_RIG_ID,
  rigSchemaVersion: STANDARD_RIG_SCHEMA_VERSION,
  bones: STANDARD_RIG_BONES
};

const boneNameSet = new Set(STANDARD_RIG_BONES.map((bone) => bone.name));

export function isStandardRigBoneName(name: string): boolean {
  return boneNameSet.has(name);
}

export { STANDARD_RIG_BONES } from "./rig-data";
