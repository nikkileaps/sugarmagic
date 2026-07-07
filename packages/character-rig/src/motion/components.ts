/**
 * packages/character-rig/src/motion/components.ts
 *
 * Purpose: Plan 063 §063.1 — the MotionComponent Strategy seam. A
 * component models one conceptual piece of motion ("breathing",
 * "weight shift", "leg cycle") as a first-class object that
 * contributes curves to semantic channels. Generators are
 * component STACKS; contributions to the same channel sum at
 * sampling. This is the reuse seam walk/run ride (§063.2) and the
 * unit future generators (sit, wave, carry) are built from.
 *
 * Status: active
 */

import type { PeriodicCurve } from "./curves";
import type { SemanticChannel } from "./projection";

/** What one component adds to the composed motion. */
export interface MotionContribution {
  channels?: Partial<Record<SemanticChannel, PeriodicCurve>>;
  /** Vertical hips offset (meters, contract scale). */
  bounce?: PeriodicCurve;
}

/**
 * One conceptual piece of motion. `TParams` is the generator's
 * recipe param shape (personality + seed); components derive any
 * internal seeds from `params.seed` with stable offsets so the
 * whole stack stays deterministic.
 */
export interface MotionComponent<TParams> {
  /** Conceptual name — debug/recipe facing ("breathing"). */
  readonly componentId: string;
  contribute(params: TParams): MotionContribution;
}

/** Composed, pre-sampling motion: curve STACKS per channel. */
export interface ComposedMotion {
  /** Loop duration in seconds. */
  duration: number;
  channels: Partial<Record<SemanticChannel, PeriodicCurve[]>>;
  bounce: PeriodicCurve[];
}

/** Run a component stack and merge contributions per channel. */
export function composeComponents<TParams>(
  components: Array<MotionComponent<TParams>>,
  params: TParams,
  duration: number
): ComposedMotion {
  const channels: Partial<Record<SemanticChannel, PeriodicCurve[]>> = {};
  const bounce: PeriodicCurve[] = [];
  for (const component of components) {
    const contribution = component.contribute(params);
    for (const [channel, curve] of Object.entries(contribution.channels ?? {})) {
      if (!curve) continue;
      const key = channel as SemanticChannel;
      (channels[key] ??= []).push(curve);
    }
    if (contribution.bounce) bounce.push(contribution.bounce);
  }
  return { duration, channels, bounce };
}
