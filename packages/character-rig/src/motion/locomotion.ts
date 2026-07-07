/**
 * packages/character-rig/src/motion/locomotion.ts
 *
 * Purpose: Plan 063 §063.2 — walk and run generators as ONE
 * component stack at two gait parameterizations (run is walk's
 * components, not a fork). Components: leg cycle (anti-phase
 * thighs, mostly-positive knee flexion via a DC harmonic, foot
 * roll), hip motion (pelvis twist + lateral weight), arm
 * counter-swing (each arm in phase with the OPPOSITE leg), body
 * bounce (two per stride), head stabilization (counters the
 * bounce pitch).
 *
 * Phase convention: one loop = one full stride (left step + right
 * step). Left leg swings forward around phase 0, right around
 * 0.5. A DC offset is a `cycles: 0, phase: 0.25` harmonic
 * (sin(pi/2) = 1) — used wherever articulation must stay
 * one-sided (knees only bend forward).
 *
 * Deterministic; amplitudes analytic, taste-tuned in §063.4.
 *
 * Status: active
 */

import type { MotionComponent } from "./components";
import { composeComponents, type ComposedMotion } from "./components";
import type { PersonalityParams } from "./idle";
import { tailWag } from "./tail";

/** Gait scaling — WALK vs RUN parameterizations of one stack. */
export interface GaitConfig {
  /** Stride seconds at energy 0 / energy 1. */
  strideSlow: number;
  strideFast: number;
  /** Base amplitudes (radians / meters) the personality scales. */
  legSwing: number;
  kneeFlex: number;
  footPitch: number;
  armSwing: number;
  hipTwist: number;
  weightShift: number;
  bounce: number;
  torsoLean: number;
}

export const WALK_GAIT: GaitConfig = {
  strideSlow: 1.35,
  strideFast: 0.95,
  legSwing: 0.45,
  kneeFlex: 0.5,
  footPitch: 0.25,
  armSwing: 0.28,
  hipTwist: 0.08,
  weightShift: 0.05,
  bounce: 0.012,
  torsoLean: 0.04
};

export const RUN_GAIT: GaitConfig = {
  strideSlow: 0.8,
  strideFast: 0.55,
  legSwing: 0.75,
  kneeFlex: 0.95,
  footPitch: 0.35,
  armSwing: 0.55,
  hipTwist: 0.12,
  weightShift: 0.04,
  bounce: 0.03,
  torsoLean: 0.14
};

export interface LocomotionRecipeParams extends PersonalityParams {
  seed: number;
  gait: GaitConfig;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** DC offset harmonic: constant `amplitude` at every phase. */
function dc(amplitude: number) {
  return { cycles: 0, amplitude, phase: 0.25 };
}

/** Anti-phase thigh swing + one-sided knee flexion + foot roll. */
const legCycle: MotionComponent<LocomotionRecipeParams> = {
  componentId: "leg-cycle",
  contribute: ({ gait, energy }) => {
    const swing = gait.legSwing * lerp(0.85, 1.15, energy);
    const flex = gait.kneeFlex * lerp(0.85, 1.15, energy);
    return {
      channels: {
        legSwingL: { harmonics: [{ cycles: 1, amplitude: swing, phase: 0 }] },
        legSwingR: { harmonics: [{ cycles: 1, amplitude: swing, phase: 0.5 }] },
        // Knee: mostly-positive flexion peaking mid-swing — DC
        // keeps the joint from hyperextending backward.
        kneeFlexL: {
          harmonics: [
            dc(flex * 0.5),
            { cycles: 1, amplitude: flex * 0.5, phase: 0.12 }
          ]
        },
        kneeFlexR: {
          harmonics: [
            dc(flex * 0.5),
            { cycles: 1, amplitude: flex * 0.5, phase: 0.62 }
          ]
        },
        footPitchL: {
          harmonics: [{ cycles: 1, amplitude: gait.footPitch, phase: 0.3 }]
        },
        footPitchR: {
          harmonics: [{ cycles: 1, amplitude: gait.footPitch, phase: 0.8 }]
        }
      }
    };
  }
};

/** Pelvis twist toward the stepping leg + lateral weight roll. */
const hipMotion: MotionComponent<LocomotionRecipeParams> = {
  componentId: "hip-motion",
  contribute: ({ gait, bounce }) => ({
    channels: {
      hipTwist: {
        harmonics: [{ cycles: 1, amplitude: gait.hipTwist, phase: 0 }]
      },
      weightShift: {
        harmonics: [
          {
            cycles: 1,
            amplitude: gait.weightShift * lerp(0.7, 1.3, bounce),
            phase: 0.25
          }
        ]
      }
    }
  })
};

/** Arms counter-swing: each arm in phase with the OPPOSITE leg. */
const armSwing: MotionComponent<LocomotionRecipeParams> = {
  componentId: "arm-swing",
  contribute: ({ gait, energy }) => {
    const amplitude = gait.armSwing * lerp(0.6, 1.4, energy);
    return {
      channels: {
        armSwingL: { harmonics: [{ cycles: 1, amplitude, phase: 0.5 }] },
        armSwingR: { harmonics: [{ cycles: 1, amplitude, phase: 0 }] }
      }
    };
  }
};

/** Vertical bob, twice per stride, plus the forward gait lean. */
const bodyBounce: MotionComponent<LocomotionRecipeParams> = {
  componentId: "body-bounce",
  contribute: ({ gait, bounce }) => ({
    channels: {
      torsoLean: { harmonics: [dc(gait.torsoLean)] }
    },
    bounce: {
      harmonics: [
        {
          cycles: 2,
          amplitude: gait.bounce * lerp(0.5, 1.5, bounce),
          phase: 0.5
        }
      ]
    }
  })
};

/** Head counters the bounce pitch so the gaze stays level. */
const headStabilization: MotionComponent<LocomotionRecipeParams> = {
  componentId: "head-stabilization",
  contribute: ({ gait, curiosity }) => ({
    channels: {
      headNod: {
        harmonics: [
          { cycles: 2, amplitude: -gait.torsoLean * 0.4, phase: 0.5 },
          dc(-gait.torsoLean * 0.7)
        ]
      },
      headTurn: {
        harmonics: [
          { cycles: 1, amplitude: lerp(0, 0.03, curiosity), phase: 0.2 }
        ]
      }
    }
  })
};

export const LOCOMOTION_COMPONENTS: Array<
  MotionComponent<LocomotionRecipeParams>
> = [legCycle, hipMotion, armSwing, bodyBounce, headStabilization, tailWag];

function generateLocomotion(
  params: Omit<LocomotionRecipeParams, "gait">,
  gait: GaitConfig
): ComposedMotion {
  const full: LocomotionRecipeParams = { ...params, gait };
  const duration = lerp(gait.strideSlow, gait.strideFast, params.energy);
  return composeComponents(LOCOMOTION_COMPONENTS, full, duration);
}

export function generateWalkChannels(
  params: Omit<LocomotionRecipeParams, "gait">
): ComposedMotion {
  return generateLocomotion(params, WALK_GAIT);
}

export function generateRunChannels(
  params: Omit<LocomotionRecipeParams, "gait">
): ComposedMotion {
  return generateLocomotion(params, RUN_GAIT);
}
