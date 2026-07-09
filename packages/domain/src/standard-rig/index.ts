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

import { STANDARD_RIG_BONES, STANDARD_RIG_RELAXED_POSE_DATA } from "./rig-data";

// v2 (2026-07-07, Plan 064): OPTIONAL tail extension added
// (DEF-tail.001..003 off DEF-hips; see ./tail-extension). Additive
// optional bones — name-based binding degrades gracefully in both
// directions, so v1 content needs no migration.
export const STANDARD_RIG_SCHEMA_VERSION = 2;

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

/**
 * The CORE deform set the wizard actually generates (2026-07-06,
 * nikki): the full contract carries the source rig's 30 finger
 * bones, but stylized mitten-handed characters neither need nor
 * want them — they pollute weights around the hands and bloat
 * the future weight-paint bone list. Hands are ONE bone each;
 * feet are foot + toe. Vendored clips have their finger tracks
 * stripped at extraction, so core skeletons play them cleanly.
 * The full 53-bone contract remains recorded for a future
 * "detailed hands" tier.
 */
export const STANDARD_RIG_CORE_BONE_NAMES: readonly string[] = [
  "root",
  "DEF-hips",
  "DEF-spine.001",
  "DEF-spine.002",
  "DEF-spine.003",
  "DEF-neck",
  "DEF-head",
  "DEF-shoulder.L",
  "DEF-upper_arm.L",
  "DEF-forearm.L",
  "DEF-hand.L",
  "DEF-shoulder.R",
  "DEF-upper_arm.R",
  "DEF-forearm.R",
  "DEF-hand.R",
  "DEF-thigh.L",
  "DEF-shin.L",
  "DEF-foot.L",
  "DEF-toe.L",
  "DEF-thigh.R",
  "DEF-shin.R",
  "DEF-foot.R",
  "DEF-toe.R"
];

const coreNameSet = new Set(STANDARD_RIG_CORE_BONE_NAMES);

export const STANDARD_RIG_CORE: StandardRigDefinition = {
  rigId: STANDARD_RIG_ID,
  rigSchemaVersion: STANDARD_RIG_SCHEMA_VERSION,
  bones: STANDARD_RIG_BONES.filter((bone) => coreNameSet.has(bone.name))
};

export function isStandardRigCoreBoneName(name: string): boolean {
  return coreNameSet.has(name);
}

const boneNameSet = new Set(STANDARD_RIG_BONES.map((bone) => bone.name));

export function isStandardRigBoneName(name: string): boolean {
  return boneNameSet.has(name);
}

export { STANDARD_RIG_BONES } from "./rig-data";

/**
 * Per-bone mean Idle_Loop rotation as an offset from contract
 * rest — the relaxed base pose (Plan 063): procedural generators
 * layer their motion on top of the ARM subset so characters hang
 * their arms instead of holding the contract T-pose.
 */
export const STANDARD_RIG_RELAXED_POSE = STANDARD_RIG_RELAXED_POSE_DATA;

export {
  STANDARD_RIG_TAIL_BONES,
  STANDARD_RIG_TAIL_LANDMARK_BONES,
  isStandardRigTailBoneName
} from "./tail-extension";

import {
  STANDARD_RIG_TAIL_BONES as TAIL_BONES_INTERNAL
} from "./tail-extension";

/** The core wizard skeleton PLUS the optional tail chain — the
 *  bone set for characters rigged with "Has tail" (Plan 064). */
export const STANDARD_RIG_CORE_WITH_TAIL: StandardRigDefinition = {
  rigId: STANDARD_RIG.rigId,
  rigSchemaVersion: STANDARD_RIG_SCHEMA_VERSION,
  bones: [...STANDARD_RIG_CORE.bones, ...TAIL_BONES_INTERNAL]
};
