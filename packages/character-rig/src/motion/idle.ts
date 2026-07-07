/**
 * packages/character-rig/src/motion/idle.ts
 *
 * Purpose: Plan 063 §063.1 — the idle generator: a stack of
 * MotionComponents (breathing, weight shift, head motion, arm
 * drift) composed from the four personality controls. Breathing
 * owns BOTH the chest curve and the breath-synced vertical bob —
 * the component models the concept, not a channel. Cozy defaults.
 *
 * Deterministic: all variation derives from `seed` with stable
 * per-component offsets. Amplitudes are radians (rotations) /
 * meters (bounce) at contract scale, set analytically — the
 * §063.4 live preview is where they get taste-tuned.
 *
 * Status: active
 */

import type { MotionComponent } from "./components";
import { composeComponents, type ComposedMotion } from "./components";
import { tailWag } from "./tail";

/** The four personality controls, each 0..1. */
export interface PersonalityParams {
  energy: number;
  bounce: number;
  curiosity: number;
  fidgetiness: number;
}

export interface IdleRecipeParams extends PersonalityParams {
  seed: number;
}

export const IDLE_DEFAULTS: IdleRecipeParams = {
  energy: 0.35,
  bounce: 0.4,
  curiosity: 0.45,
  fidgetiness: 0.3,
  seed: 1
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Breathing: chest rise with neck counter + breath-synced bob. */
const breathing: MotionComponent<IdleRecipeParams> = {
  componentId: "breathing",
  contribute: (params) => ({
    channels: {
      breathing: {
        harmonics: [
          { cycles: 3, amplitude: lerp(0.015, 0.035, params.energy), phase: 0 }
        ]
      }
    },
    bounce: {
      // Same cycle count as the breath so the body settles on the
      // exhale.
      harmonics: [
        { cycles: 3, amplitude: lerp(0.001, 0.008, params.bounce), phase: 0.5 }
      ]
    }
  })
};

/** Weight shift: slow lateral sway plus fidget wobble. */
const weightShift: MotionComponent<IdleRecipeParams> = {
  componentId: "weight-shift",
  contribute: (params) => ({
    channels: {
      weightShift: {
        harmonics: [
          {
            cycles: 1,
            amplitude: lerp(0.02, 0.06, params.fidgetiness),
            phase: 0.25
          }
        ],
        noise: {
          seed: params.seed * 31 + 1,
          amplitude: lerp(0, 0.02, params.fidgetiness),
          points: 6
        }
      }
    }
  })
};

/** Head motion: look-arounds, nods, tilts, torso follow-through. */
const headMotion: MotionComponent<IdleRecipeParams> = {
  componentId: "head-motion",
  contribute: (params) => ({
    channels: {
      headTurn: {
        harmonics: [
          { cycles: 1, amplitude: lerp(0.01, 0.05, params.curiosity), phase: 0.6 }
        ],
        noise: {
          seed: params.seed * 31 + 2,
          amplitude: lerp(0.01, 0.09, params.curiosity),
          points: Math.round(lerp(4, 9, params.curiosity))
        }
      },
      headNod: {
        harmonics: [
          { cycles: 2, amplitude: lerp(0.005, 0.025, params.curiosity), phase: 0.1 }
        ],
        noise: {
          seed: params.seed * 31 + 3,
          amplitude: lerp(0.005, 0.03, params.curiosity),
          points: 5
        }
      },
      headTilt: {
        harmonics: [
          { cycles: 1, amplitude: lerp(0.004, 0.02, params.curiosity), phase: 0.8 }
        ]
      },
      torsoSway: {
        harmonics: [
          { cycles: 1, amplitude: lerp(0.006, 0.03, params.curiosity), phase: 0.4 }
        ]
      }
    }
  })
};

/** Arm drift: subtle hang-drift, livelier with energy + fidget. */
const armDrift: MotionComponent<IdleRecipeParams> = {
  componentId: "arm-drift",
  contribute: (params) => ({
    channels: {
      armDrift: {
        harmonics: [
          {
            cycles: 2,
            amplitude: lerp(0.008, 0.03, (params.energy + params.fidgetiness) / 2),
            phase: 0.5
          }
        ],
        noise: {
          seed: params.seed * 31 + 4,
          amplitude: lerp(0, 0.012, params.fidgetiness),
          points: 5
        }
      }
    }
  })
};

/** The idle stack — the plan's composition, as objects. */
export const IDLE_COMPONENTS: Array<MotionComponent<IdleRecipeParams>> = [
  breathing,
  weightShift,
  headMotion,
  armDrift,
  tailWag
];

/** Compose the idle from personality params. */
export function generateIdleChannels(params: IdleRecipeParams): ComposedMotion {
  // Energy compresses the loop (faster breathing/sway all at once).
  const duration = lerp(9, 5, params.energy);
  return composeComponents(IDLE_COMPONENTS, params, duration);
}
