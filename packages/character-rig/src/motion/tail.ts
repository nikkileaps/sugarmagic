/**
 * packages/character-rig/src/motion/tail.ts
 *
 * Purpose: Plan 064 §064.3 — the tail wag MotionComponent: lateral
 * sway per chain link with PHASE LAG down the chain (base leads,
 * mid follows, tip whips last — the lag is the cuteness).
 * Amplitude grows toward the tip; Fidgetiness drives liveliness,
 * Energy adds a little rate variance via noise. Joins the idle and
 * locomotion stacks unconditionally: tail channels project onto
 * tail bones only, and tail-less clip assembly drops those tracks,
 * so tail-less characters cost nothing.
 *
 * Status: active
 */

import type { MotionComponent } from "./components";
import type { PersonalityParams } from "./idle";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface TailWagParams extends PersonalityParams {
  seed: number;
}

export const TAIL_WAG_LAG = 0.07;

export const tailWag: MotionComponent<TailWagParams> = {
  componentId: "tail-wag",
  contribute: (params) => {
    const amplitude = lerp(0.04, 0.16, params.fidgetiness);
    const cycles = 2;
    return {
      channels: {
        tailSway1: {
          harmonics: [{ cycles, amplitude, phase: 0 }],
          noise: {
            seed: params.seed * 31 + 9,
            amplitude: lerp(0, 0.03, params.energy),
            points: 5
          }
        },
        tailSway2: {
          harmonics: [
            { cycles, amplitude: amplitude * 1.35, phase: -TAIL_WAG_LAG }
          ]
        },
        tailSway3: {
          harmonics: [
            { cycles, amplitude: amplitude * 1.7, phase: -TAIL_WAG_LAG * 2 }
          ]
        }
      }
    };
  }
};
