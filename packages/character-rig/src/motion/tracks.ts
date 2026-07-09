/**
 * packages/character-rig/src/motion/tracks.ts
 *
 * Purpose: Plan 063 §063.1 — compose semantic channel curves into
 * sampled bone tracks. Rotations are absolute CONTRACT-local
 * quaternions (rest ⊗ small-euler offset) — the same convention
 * vendored clips use, so rest-aligned wizard skeletons play
 * generated clips verbatim (ADR 023 decision 4). Hips translation
 * is emitted in the contract's local frame so the existing
 * hip-height scaling applies at copy time unchanged.
 *
 * Status: active
 */

import { STANDARD_RIG_CORE_WITH_TAIL } from "@sugarmagic/domain";
import { quatMultiply, type Quat, type Vec3 } from "../math";
import { evaluateCurve, type PeriodicCurve } from "./curves";
import type { ComposedMotion } from "./components";
import { CHANNEL_PROJECTION, type SemanticChannel } from "./projection";
import { evaluateOverrideCurve, type CurvePoint } from "./override-curve";

function evaluateStack(curves: PeriodicCurve[], phase: number): number {
  let value = 0;
  for (const curve of curves) value += evaluateCurve(curve, phase);
  return value;
}

export interface SampledBoneTrack {
  boneName: string;
  /** Keyframe times, seconds; last key == duration (loop close). */
  times: Float32Array;
  /** Quaternion per key, xyzw. */
  rotations: Float32Array;
}

export interface SampledMotion {
  duration: number;
  boneTracks: SampledBoneTrack[];
  /** Hips translation keys (contract-local), or null if no bounce. */
  hipsTranslation: { times: Float32Array; values: Float32Array } | null;
}

function quatFromEuler(x: number, y: number, z: number): Quat {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  // XYZ order — offsets are small, order is not load-bearing.
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz
  ];
}

export const MOTION_SAMPLE_FPS = 24;

export interface SampleMotionOptions {
  /** Constant per-bone rotation offsets layered UNDER the channel
   *  motion (q = rest * base * channelOffset) — the relaxed base
   *  pose that keeps generated clips out of the contract T-pose.
   *  Bones listed here always get a track, channels or not. */
  basePose?: Readonly<Record<string, readonly number[]>>;
  /** §063.6 — user curve overrides: a channel listed here REPLACES
   *  its generated signal with the periodic point curve. The key
   *  "bounce" overrides the hips bob. */
  channelOverrides?: Readonly<Record<string, readonly CurvePoint[]>>;
}

/**
 * Sample channel curves into per-bone quaternion tracks. Bones no
 * channel (and no base pose) touches are omitted entirely
 * (smaller clips; untouched bones hold their rest pose at
 * playback).
 */
export function sampleMotion(
  motion: ComposedMotion,
  options: SampleMotionOptions = {}
): SampledMotion {
  const frameCount = Math.max(2, Math.round(motion.duration * MOTION_SAMPLE_FPS));
  const keyCount = frameCount + 1; // final key repeats phase 0 at t=duration

  // Collect per-bone euler offsets per key.
  const boneEulers = new Map<string, Float64Array>(); // 3 per key
  const touch = (boneName: string): Float64Array => {
    let eulers = boneEulers.get(boneName);
    if (!eulers) {
      eulers = new Float64Array(keyCount * 3);
      boneEulers.set(boneName, eulers);
    }
    return eulers;
  };
  const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

  // Base-pose bones always emit a track, even without channels.
  for (const boneName of Object.keys(options.basePose ?? {})) {
    touch(boneName);
  }

  for (const [channelName, curves] of Object.entries(motion.channels)) {
    if (!curves || curves.length === 0) continue;
    const projection = CHANNEL_PROJECTION[channelName as SemanticChannel];
    const override = options.channelOverrides?.[channelName];
    for (let key = 0; key < keyCount; key += 1) {
      const phase = (key % frameCount) / frameCount;
      const value = override
        ? evaluateOverrideCurve(override, phase)
        : evaluateStack(curves, phase);
      for (const target of projection) {
        touch(target.boneName)[key * 3 + AXIS_INDEX[target.axis]] +=
          value * target.gain;
      }
    }
  }

  // Superset incl. the optional tail: tail-less clip assembly
  // simply drops tail tracks (buildClipGlb skips unknown targets).
  const restByName = new Map(
    STANDARD_RIG_CORE_WITH_TAIL.bones.map((bone) => [
      bone.name,
      {
        rotation: [
          bone.restRotation[0]!,
          bone.restRotation[1]!,
          bone.restRotation[2]!,
          bone.restRotation[3]!
        ] as Quat,
        position: [
          bone.restPosition[0]!,
          bone.restPosition[1]!,
          bone.restPosition[2]!
        ] as Vec3
      }
    ])
  );

  const times = new Float32Array(keyCount);
  for (let key = 0; key < keyCount; key += 1) {
    times[key] = (key / frameCount) * motion.duration;
  }

  const boneTracks: SampledBoneTrack[] = [];
  for (const [boneName, eulers] of boneEulers) {
    const rest = restByName.get(boneName);
    if (!rest) continue; // non-core target in the table = data bug; skip
    const baseRaw = options.basePose?.[boneName];
    const base: Quat | null = baseRaw
      ? [baseRaw[0]!, baseRaw[1]!, baseRaw[2]!, baseRaw[3]!]
      : null;
    const restWithBase = base ? quatMultiply(rest.rotation, base) : rest.rotation;
    const rotations = new Float32Array(keyCount * 4);
    for (let key = 0; key < keyCount; key += 1) {
      const offset = quatFromEuler(
        eulers[key * 3]!,
        eulers[key * 3 + 1]!,
        eulers[key * 3 + 2]!
      );
      const q = quatMultiply(restWithBase, offset);
      rotations[key * 4] = q[0];
      rotations[key * 4 + 1] = q[1];
      rotations[key * 4 + 2] = q[2];
      rotations[key * 4 + 3] = q[3];
    }
    boneTracks.push({ boneName, times: times.slice(), rotations });
  }

  let hipsTranslation: SampledMotion["hipsTranslation"] = null;
  const bounceOverride = options.channelOverrides?.["bounce"];
  if (motion.bounce.length > 0 || bounceOverride) {
    const hipsRest = restByName.get("DEF-hips")!.position;
    const values = new Float32Array(keyCount * 3);
    for (let key = 0; key < keyCount; key += 1) {
      const phase = (key % frameCount) / frameCount;
      const lift = bounceOverride
        ? evaluateOverrideCurve(bounceOverride, phase)
        : evaluateStack(motion.bounce, phase);
      // Contract-local: root carries the Z-up fix, so local +Z is
      // world up (hips rest z ~= standing hip height).
      values[key * 3] = hipsRest[0];
      values[key * 3 + 1] = hipsRest[1];
      values[key * 3 + 2] = hipsRest[2] + lift;
    }
    hipsTranslation = { times: times.slice(), values };
  }

  return { duration: motion.duration, boneTracks, hipsTranslation };
}
