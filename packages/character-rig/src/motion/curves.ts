/**
 * packages/character-rig/src/motion/curves.ts
 *
 * Purpose: Plan 063 §063.1 — periodic scalar curve primitives for
 * procedural animation. A semantic motion curve is a function of
 * loop phase [0,1) built from harmonics (sine terms at integer
 * cycle counts) plus PERIODIC seeded value noise — periodic by
 * construction, so every generated clip loops perfectly with no
 * seam authoring (Plan 063 decision 6), and deterministic for a
 * given seed (decision 3: same recipe = byte-identical clip).
 *
 * Status: active
 */

/** Deterministic PRNG (mulberry32) — the only randomness source
 *  in motion generation; seeded from the recipe, never the clock. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Harmonic {
  /** Whole cycles per loop — integers keep the loop closed. */
  cycles: number;
  amplitude: number;
  /** Phase offset in cycles, 0..1. */
  phase: number;
}

export interface PeriodicNoise {
  seed: number;
  amplitude: number;
  /** Grid points around the loop; more = busier wiggle. */
  points: number;
}

/**
 * A periodic scalar curve: sum of harmonics + optional periodic
 * value noise, evaluated at phase [0,1). Everything is data (no
 * closures) so curves can live in recipes and, later, carry the
 * §063.5 Bezier overrides.
 */
export interface PeriodicCurve {
  harmonics: Harmonic[];
  noise?: PeriodicNoise;
}

/** Smooth (cosine) interpolation between periodic grid values. */
function sampleWrappedGrid(values: number[], phase: number): number {
  const count = values.length;
  const scaled = phase * count;
  const index = Math.floor(scaled) % count;
  const next = (index + 1) % count;
  const t = scaled - Math.floor(scaled);
  const smooth = 0.5 * (1 - Math.cos(t * Math.PI));
  return values[index]! * (1 - smooth) + values[next]! * smooth;
}

const noiseGridCache = new Map<string, number[]>();

function noiseGrid(noise: PeriodicNoise): number[] {
  const key = `${noise.seed}:${noise.points}`;
  let grid = noiseGridCache.get(key);
  if (!grid) {
    const rng = createRng(noise.seed);
    grid = Array.from({ length: noise.points }, () => rng() * 2 - 1);
    noiseGridCache.set(key, grid);
  }
  return grid;
}

/** Evaluate a curve at loop phase [0,1). Periodic by construction. */
export function evaluateCurve(curve: PeriodicCurve, phase: number): number {
  const wrapped = phase - Math.floor(phase);
  let value = 0;
  for (const harmonic of curve.harmonics) {
    value +=
      harmonic.amplitude *
      Math.sin((wrapped * harmonic.cycles + harmonic.phase) * Math.PI * 2);
  }
  if (curve.noise && curve.noise.amplitude !== 0) {
    value += curve.noise.amplitude * sampleWrappedGrid(noiseGrid(curve.noise), wrapped);
  }
  return value;
}
