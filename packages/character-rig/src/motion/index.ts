/**
 * packages/character-rig/src/motion/index.ts
 *
 * Purpose: Plan 063 — procedural motion generation public surface.
 *
 * Status: active
 */

export {
  createRng,
  evaluateCurve,
  type Harmonic,
  type PeriodicCurve,
  type PeriodicNoise
} from "./curves";
export {
  CHANNEL_PROJECTION,
  type BoneAxisGain,
  type SemanticChannel
} from "./projection";
export {
  MOTION_SAMPLE_FPS,
  sampleMotion,
  type MotionChannels,
  type SampledBoneTrack,
  type SampledMotion
} from "./tracks";
export {
  IDLE_DEFAULTS,
  generateIdleChannels,
  type IdleRecipeParams,
  type PersonalityParams
} from "./idle";
