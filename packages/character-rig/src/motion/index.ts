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
export { RELAXED_ARM_POSE, composeBasePose } from "./base-pose";
export {
  evaluateOverrideCurve,
  normalizeOverridePoints,
  type CurvePoint
} from "./override-curve";
export {
  composeComponents,
  type ComposedMotion,
  type MotionComponent,
  type MotionContribution
} from "./components";
export {
  MOTION_SAMPLE_FPS,
  sampleMotion,
  type SampledBoneTrack,
  type SampledMotion
} from "./tracks";
export {
  IDLE_COMPONENTS,
  IDLE_DEFAULTS,
  generateIdleChannels,
  type IdleRecipeParams,
  type PersonalityParams
} from "./idle";
export {
  LOCOMOTION_COMPONENTS,
  RUN_GAIT,
  WALK_GAIT,
  generateRunChannels,
  generateWalkChannels,
  type GaitConfig,
  type LocomotionRecipeParams
} from "./locomotion";
export { TAIL_WAG_LAG, sampleTailWag, tailWag, type TailWagParams } from "./tail";
