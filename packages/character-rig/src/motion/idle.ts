/**
 * packages/character-rig/src/motion/idle.ts
 *
 * Purpose: Plan 063 §063.1 — the idle generator: breathing +
 * weight shift + head motion + arm drift composed from the four
 * personality controls. Cozy defaults; every control maps to
 * amplitudes/frequencies per the plan's table (Energy: speed +
 * arm swing; Bounce: vertical + hips + shoulders; Curiosity: head
 * + torso + look-around frequency; Fidgetiness: variation +
 * weight shifting + hand movement).
 *
 * Deterministic: all variation comes from `seed`. Amplitude
 * numbers are radians (rotation channels) / meters (bounce) at
 * contract scale, chosen analytically — the §063.4 live preview
 * is where they get taste-tuned.
 *
 * Status: active
 */

import type { MotionChannels } from "./tracks";

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

/** Compose the idle's semantic channels from personality params. */
export function generateIdleChannels(params: IdleRecipeParams): MotionChannels {
  const { energy, bounce, curiosity, fidgetiness, seed } = params;
  // Energy compresses the loop (faster breathing/sway all at once).
  const duration = lerp(9, 5, energy);

  return {
    duration,
    channels: {
      breathing: {
        // Two-ish breaths per loop; deeper with energy.
        harmonics: [
          { cycles: 3, amplitude: lerp(0.015, 0.035, energy), phase: 0 }
        ]
      },
      weightShift: {
        // One slow sway per loop plus fidget wobble.
        harmonics: [
          { cycles: 1, amplitude: lerp(0.02, 0.06, fidgetiness), phase: 0.25 }
        ],
        noise: {
          seed: seed * 31 + 1,
          amplitude: lerp(0, 0.02, fidgetiness),
          points: 6
        }
      },
      headTurn: {
        // Look-arounds: noise-driven wandering, busier + wider
        // with curiosity.
        harmonics: [
          { cycles: 1, amplitude: lerp(0.01, 0.05, curiosity), phase: 0.6 }
        ],
        noise: {
          seed: seed * 31 + 2,
          amplitude: lerp(0.01, 0.09, curiosity),
          points: Math.round(lerp(4, 9, curiosity))
        }
      },
      headNod: {
        harmonics: [
          { cycles: 2, amplitude: lerp(0.005, 0.025, curiosity), phase: 0.1 }
        ],
        noise: {
          seed: seed * 31 + 3,
          amplitude: lerp(0.005, 0.03, curiosity),
          points: 5
        }
      },
      headTilt: {
        harmonics: [
          { cycles: 1, amplitude: lerp(0.004, 0.02, curiosity), phase: 0.8 }
        ]
      },
      torsoSway: {
        harmonics: [
          { cycles: 1, amplitude: lerp(0.006, 0.03, curiosity), phase: 0.4 }
        ]
      },
      armDrift: {
        // Subtle hang-drift; livelier with energy + fidgetiness.
        harmonics: [
          {
            cycles: 2,
            amplitude: lerp(0.008, 0.03, (energy + fidgetiness) / 2),
            phase: 0.5
          }
        ],
        noise: {
          seed: seed * 31 + 4,
          amplitude: lerp(0, 0.012, fidgetiness),
          points: 5
        }
      }
    },
    bounce: {
      // Breath-synced vertical bob (same cycle count as breathing
      // so the body settles with the exhale).
      harmonics: [
        { cycles: 3, amplitude: lerp(0.001, 0.008, bounce), phase: 0.5 }
      ]
    }
  };
}
