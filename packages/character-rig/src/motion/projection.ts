/**
 * packages/character-rig/src/motion/projection.ts
 *
 * Purpose: Plan 063 §063.1 — the fixed mapping from SEMANTIC
 * motion channels ("breathing", "weightShift"...) onto standard-
 * rig bone rotations. Users and generators think in motion terms;
 * this table is the only place bone names appear. Gains distribute
 * one channel across a chain (breathing moves chest + counter-
 * moves neck) — per-channel AMPLITUDE lives in the generator's
 * curves, per-bone PROPORTION lives here.
 *
 * Axis values are contract-rig bone-local. The proportions were
 * set analytically and are expected to be tuned against the live
 * preview in §063.4 — tests assert structure, determinism, and
 * monotonicity, never aesthetics.
 *
 * Status: active
 */

export type SemanticChannel =
  | "breathing"
  | "weightShift"
  | "headNod"
  | "headTurn"
  | "headTilt"
  | "armDrift"
  | "torsoSway"
  | "torsoLean"
  | "hipTwist"
  | "legSwingL"
  | "legSwingR"
  | "kneeFlexL"
  | "kneeFlexR"
  | "footPitchL"
  | "footPitchR"
  | "armSwingL"
  | "armSwingR";

export interface BoneAxisGain {
  boneName: string;
  axis: "x" | "y" | "z";
  gain: number;
}

/**
 * Channel -> weighted bone-axis contributions. Rotations are
 * radians of offset around the CONTRACT rest pose (generated
 * clips carry absolute contract-local rotations, the same
 * convention vendored clips use — ADR 023 decision 4 playback
 * applies unchanged).
 */
export const CHANNEL_PROJECTION: Record<SemanticChannel, BoneAxisGain[]> = {
  breathing: [
    { boneName: "DEF-spine.002", axis: "x", gain: 1.0 },
    { boneName: "DEF-spine.003", axis: "x", gain: 0.6 },
    { boneName: "DEF-neck", axis: "x", gain: -0.35 },
    { boneName: "DEF-shoulder.L", axis: "z", gain: 0.25 },
    { boneName: "DEF-shoulder.R", axis: "z", gain: -0.25 }
  ],
  weightShift: [
    { boneName: "DEF-hips", axis: "z", gain: 1.0 },
    { boneName: "DEF-spine.001", axis: "z", gain: -0.45 },
    { boneName: "DEF-spine.003", axis: "z", gain: -0.3 },
    { boneName: "DEF-head", axis: "z", gain: -0.15 }
  ],
  headNod: [
    { boneName: "DEF-head", axis: "x", gain: 1.0 },
    { boneName: "DEF-neck", axis: "x", gain: 0.35 }
  ],
  headTurn: [
    { boneName: "DEF-head", axis: "y", gain: 1.0 },
    { boneName: "DEF-neck", axis: "y", gain: 0.4 }
  ],
  headTilt: [
    { boneName: "DEF-head", axis: "z", gain: 1.0 }
  ],
  armDrift: [
    { boneName: "DEF-upper_arm.L", axis: "z", gain: 1.0 },
    { boneName: "DEF-upper_arm.R", axis: "z", gain: -1.0 },
    { boneName: "DEF-forearm.L", axis: "x", gain: 0.4 },
    { boneName: "DEF-forearm.R", axis: "x", gain: 0.4 }
  ],
  torsoSway: [
    { boneName: "DEF-spine.001", axis: "y", gain: 1.0 },
    { boneName: "DEF-spine.003", axis: "y", gain: 0.6 },
    { boneName: "DEF-head", axis: "y", gain: -0.4 }
  ],
  // Locomotion channels (§063.2). Fore/aft joint articulation is
  // bone-local X across this rig (same convention as the spine).
  torsoLean: [
    { boneName: "DEF-spine.001", axis: "x", gain: 0.5 },
    { boneName: "DEF-spine.002", axis: "x", gain: 1.0 },
    { boneName: "DEF-spine.003", axis: "x", gain: 0.6 }
  ],
  hipTwist: [
    { boneName: "DEF-hips", axis: "y", gain: 1.0 },
    { boneName: "DEF-spine.002", axis: "y", gain: -0.5 },
    { boneName: "DEF-spine.003", axis: "y", gain: -0.4 }
  ],
  legSwingL: [{ boneName: "DEF-thigh.L", axis: "x", gain: 1.0 }],
  legSwingR: [{ boneName: "DEF-thigh.R", axis: "x", gain: 1.0 }],
  kneeFlexL: [{ boneName: "DEF-shin.L", axis: "x", gain: 1.0 }],
  kneeFlexR: [{ boneName: "DEF-shin.R", axis: "x", gain: 1.0 }],
  footPitchL: [
    { boneName: "DEF-foot.L", axis: "x", gain: 1.0 },
    { boneName: "DEF-toe.L", axis: "x", gain: 0.5 }
  ],
  footPitchR: [
    { boneName: "DEF-foot.R", axis: "x", gain: 1.0 },
    { boneName: "DEF-toe.R", axis: "x", gain: 0.5 }
  ],
  armSwingL: [
    { boneName: "DEF-upper_arm.L", axis: "x", gain: 1.0 },
    { boneName: "DEF-forearm.L", axis: "x", gain: 0.35 }
  ],
  armSwingR: [
    { boneName: "DEF-upper_arm.R", axis: "x", gain: 1.0 },
    { boneName: "DEF-forearm.R", axis: "x", gain: 0.35 }
  ]
};
