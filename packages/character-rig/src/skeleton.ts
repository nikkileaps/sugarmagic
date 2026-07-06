/**
 * packages/character-rig/src/skeleton.ts
 *
 * Purpose: Plan 062 §062.2 — generate a full standard-rig
 * skeleton for a specific character from the wizard's 16
 * confirmed landmarks. Primary bones take their head positions
 * from landmarks; every other contract bone (spine intermediates,
 * fingers, toes, root) derives procedurally.
 *
 * The generated skeleton keeps the CONTRACT's local rest
 * ROTATIONS bone-for-bone (that is what makes the shared clip
 * library's rotation tracks mean the same thing on every
 * character) while local translations are recomputed from this
 * character's actual joint positions (limb lengths differ per
 * character; rotation-driven animation tolerates that).
 *
 * `hipHeight` is recorded for the clip-copy step: the library
 * rig's hips-translation tracks are authored at the library's
 * proportions and get scaled by (character hipHeight / rig
 * hipHeight) when clips are copied into a project (Plan 062
 * §062.4) — otherwise tall characters float and short ones sink.
 *
 * Status: active
 */

import {
  STANDARD_RIG,
  STANDARD_RIG_LANDMARK_BONES,
  type StandardRigBone
} from "@sugarmagic/domain";
import {
  QUAT_IDENTITY,
  quatConjugate,
  quatMultiply,
  quatRotateVec3,
  vec3Add,
  vec3Lerp,
  vec3Scale,
  vec3Sub,
  type Quat,
  type Vec3
} from "./math";

/** The 16 wizard landmarks, world space (upright +Y, facing +Z). */
export type RigLandmarks = Record<keyof typeof STANDARD_RIG_LANDMARK_BONES, Vec3> &
  Record<string, Vec3>;

export interface GeneratedBone {
  name: string;
  parentName: string | null;
  /** World-space head position for THIS character. */
  headPosition: Vec3;
  /** Local rest rotation — copied from the contract. */
  localRestRotation: Quat;
  /** Local rest translation in the parent's rest frame. */
  localRestTranslation: Vec3;
}

export interface GeneratedSkeleton {
  rigId: string;
  rigSchemaVersion: number;
  bones: GeneratedBone[];
  /** Pelvis height above ground — the clip-scale reference. */
  hipHeight: number;
}

function asVec3(a: readonly number[]): Vec3 {
  return [a[0]!, a[1]!, a[2]!];
}

function asQuat(a: readonly number[]): Quat {
  return [a[0]!, a[1]!, a[2]!, a[3]!];
}

interface ContractBoneInfo {
  bone: StandardRigBone;
  worldRestRotation: Quat;
  worldRestPosition: Vec3;
}

/**
 * Contract bones with world-space rest transforms, computed once
 * by walking the hierarchy (parents are ordered before children
 * in the generated rig data; asserted defensively).
 */
function computeContractWorld(): Map<string, ContractBoneInfo> {
  const byName = new Map<string, ContractBoneInfo>();
  for (const bone of STANDARD_RIG.bones) {
    const parent = bone.parentName ? byName.get(bone.parentName) : null;
    if (bone.parentName && !parent) {
      throw new Error(
        `standard rig data out of order: ${bone.name} before its parent ${bone.parentName}`
      );
    }
    const worldRestRotation = parent
      ? quatMultiply(parent.worldRestRotation, asQuat(bone.restRotation))
      : asQuat(bone.restRotation);
    const worldRestPosition = parent
      ? vec3Add(
          parent.worldRestPosition,
          quatRotateVec3(parent.worldRestRotation, asVec3(bone.restPosition))
        )
      : asVec3(bone.restPosition);
    byName.set(bone.name, { bone, worldRestRotation, worldRestPosition });
  }
  return byName;
}

/**
 * World head positions for every contract bone, for THIS
 * character: landmark-driven bones take the landmark; derived
 * bones interpolate/offset from their landmark-driven anchors,
 * falling back to scaling the contract's own layout by the
 * character's proportions where no better anchor exists
 * (fingers, toes).
 */
function deriveWorldHeads(landmarks: RigLandmarks): Map<string, Vec3> {
  const heads = new Map<string, Vec3>();
  const landmarkByBone = new Map<string, Vec3>();
  for (const [landmarkKey, boneName] of Object.entries(
    STANDARD_RIG_LANDMARK_BONES
  )) {
    const position = landmarks[landmarkKey];
    if (!position) {
      throw new Error(`missing landmark: ${landmarkKey}`);
    }
    landmarkByBone.set(boneName, position);
  }

  const pelvis = landmarkByBone.get("DEF-hips")!;
  const chest = landmarkByBone.get("DEF-spine.003")!;
  const contract = computeContractWorld();

  // Character-to-contract scale, from hip heights — used to scale
  // contract-relative offsets for bones with no landmark anchor.
  const contractHip = contract.get("DEF-hips")!.worldRestPosition;
  const scale = contractHip[1] !== 0 ? pelvis[1] / contractHip[1] : 1;

  heads.set("root", [pelvis[0], 0, pelvis[2]]);
  // Spine chain: hips at pelvis; two intermediates to the chest.
  heads.set("DEF-hips", pelvis);
  heads.set("DEF-spine.001", vec3Lerp(pelvis, chest, 1 / 3));
  heads.set("DEF-spine.002", vec3Lerp(pelvis, chest, 2 / 3));
  heads.set("DEF-spine.003", chest);

  for (const [boneName, position] of landmarkByBone) {
    heads.set(boneName, position);
  }
  // Upper arms start where the shoulder (clavicle) bone ends — at
  // the shoulder landmark; the shoulder bone itself starts inward
  // toward the chest.
  for (const side of ["L", "R"] as const) {
    const shoulder = landmarkByBone.get(`DEF-shoulder.${side}`)!;
    heads.set(
      `DEF-shoulder.${side}`,
      vec3Lerp(chest, shoulder, 0.4)
    );
    heads.set(`DEF-upper_arm.${side}`, shoulder);
  }

  // Everything not yet placed (fingers, thumbs, toes, anything a
  // future contract revision adds): position by transplanting the
  // bone's contract offset FROM ITS PARENT, scaled to character
  // proportions. Walk in contract order so parents resolve first.
  for (const bone of STANDARD_RIG.bones) {
    if (heads.has(bone.name)) continue;
    const parentName = bone.parentName;
    const parentHead = parentName ? heads.get(parentName) : null;
    const info = contract.get(bone.name)!;
    if (!parentName || !parentHead) {
      heads.set(bone.name, vec3Scale(info.worldRestPosition, scale));
      continue;
    }
    const parentInfo = contract.get(parentName)!;
    const contractOffset = vec3Sub(
      info.worldRestPosition,
      parentInfo.worldRestPosition
    );
    heads.set(bone.name, vec3Add(parentHead, vec3Scale(contractOffset, scale)));
  }
  return heads;
}

export function generateStandardSkeleton(
  landmarks: RigLandmarks
): GeneratedSkeleton {
  const contract = computeContractWorld();
  const heads = deriveWorldHeads(landmarks);

  // World rest rotations are the CONTRACT's (local rotations are
  // copied verbatim, so the composed world rotations match too).
  const bones: GeneratedBone[] = STANDARD_RIG.bones.map((bone) => {
    const head = heads.get(bone.name)!;
    const parentHead = bone.parentName ? heads.get(bone.parentName)! : null;
    const parentWorldRotation = bone.parentName
      ? contract.get(bone.parentName)!.worldRestRotation
      : QUAT_IDENTITY;
    const localRestTranslation = parentHead
      ? quatRotateVec3(quatConjugate(parentWorldRotation), vec3Sub(head, parentHead))
      : head;
    return {
      name: bone.name,
      parentName: bone.parentName,
      headPosition: head,
      localRestRotation: asQuat(bone.restRotation),
      localRestTranslation
    };
  });

  return {
    rigId: STANDARD_RIG.rigId,
    rigSchemaVersion: STANDARD_RIG.rigSchemaVersion,
    bones,
    hipHeight: heads.get("DEF-hips")![1]
  };
}

/**
 * Bone SEGMENTS for the weight solver: head -> primary child's
 * head (or a short extrapolated tip for leaf bones). Root is
 * excluded — it is a motion carrier, not a deformer.
 */
export interface BoneSegment {
  boneName: string;
  start: Vec3;
  end: Vec3;
}

export function computeBoneSegments(
  skeleton: GeneratedSkeleton
): BoneSegment[] {
  const childrenOf = new Map<string, GeneratedBone[]>();
  for (const bone of skeleton.bones) {
    if (!bone.parentName) continue;
    const list = childrenOf.get(bone.parentName) ?? [];
    list.push(bone);
    childrenOf.set(bone.parentName, list);
  }
  const segments: BoneSegment[] = [];
  for (const bone of skeleton.bones) {
    if (bone.name === "root") continue;
    const children = childrenOf.get(bone.name) ?? [];
    if (children.length > 0) {
      // Primary child = the first in contract order (chains have
      // exactly one; branch points like hips/chest use the first
      // and rely on the other children's own segments).
      segments.push({
        boneName: bone.name,
        start: bone.headPosition,
        end: children[0]!.headPosition
      });
    } else {
      // Leaf: extrapolate a short tip along the parent->head
      // direction so the segment has nonzero length.
      const parent = skeleton.bones.find((b) => b.name === bone.parentName);
      const direction = parent
        ? vec3Sub(bone.headPosition, parent.headPosition)
        : ([0, 0.05, 0] as Vec3);
      const tip = vec3Add(bone.headPosition, vec3Scale(direction, 0.5));
      segments.push({ boneName: bone.name, start: bone.headPosition, end: tip });
    }
  }
  return segments;
}
