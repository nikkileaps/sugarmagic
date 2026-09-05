/**
 * How a placed light moves over time: a hearth's flicker, a candle's gutter,
 * a ward's slow pulse.
 *
 * WHERE THE PIECES LIVE, the same split `camera/moves.ts` uses
 *   define   here, pure: what each behavior is and what a light should look
 *            like at a given second.
 *   apply    the host's frame loop, which owns the clock and the live lights.
 *            Nothing here touches a light or reads a clock; this is math.
 *
 * DETERMINISTIC, NOT RANDOM. `Math.random()` in a frame loop would make two
 * runs of one scene differ and put the behavior beyond testing. Everything
 * here is a function of elapsed seconds and the light's own seed, so the same
 * candle looks the same at the same second on every run, two candles with
 * different seeds never move together, and a test can assert what a flame
 * looks like at t = 3.2s.
 *
 * Nothing accumulates. Phase is recomputed from the time passed in rather than
 * stepped, so a pause, a slow frame or a reload cannot drift it.
 */

import type { PlacedLight, PlacedLightModulation } from "@sugarmagic/domain";

/**
 * THE flicker curve, in 0..1, for one seed at one moment.
 *
 * Exported and named on purpose. The near-term want after this is a lamp's
 * MESH glowing in time with its light -- an emissive material, which is
 * shader work rather than light work. If that graph invents its own flicker,
 * one look ends up with two sources that drift apart. So it either reads the
 * sampled value or is written against this curve, and there is one place to
 * look either way.
 *
 * When a material does need it, the seam is the one `ShaderRuntime` already
 * uses for `sunDirection`: publish the sampled intensity as a uniform graphs
 * can read, rather than recomputing this in TSL.
 *
 * Three sine waves whose frequencies share no common multiple, so the sum
 * repeats only over a very long period and reads as noise without being any.
 */
export function placedLightNoise(seed: number, seconds: number): number {
  const phase = seed * Math.PI * 2;
  const wave =
    Math.sin(seconds * 5.7 + phase) * 0.5 +
    Math.sin(seconds * 9.1 + phase * 1.7) * 0.3 +
    Math.sin(seconds * 14.3 + phase * 2.3) * 0.2;
  // Sum spans -1..1; shift and squeeze it into 0..1.
  return (wave + 1) / 2;
}

/** What a light should look like right now. */
export interface PlacedLightModulationSample {
  /** Candela or nits, the same unit the light was authored in. */
  intensity: number;
  /** Hex, ready to write onto the light. */
  color: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How bright the light is right now, as a fraction of its authored intensity.
 * One for a light that is not moving.
 */
function brightnessScale(
  modulation: PlacedLightModulation,
  seconds: number
): number {
  const time = seconds * modulation.speed;
  const amount = clamp01(modulation.amount);
  switch (modulation.kind) {
    case "steady":
      return 1;
    case "flame":
      // Fire is never brighter than its fuel: the noise only ever takes
      // brightness away, which is why a flame reads as flicker rather than
      // as a light being pumped.
      return 1 - amount * placedLightNoise(modulation.seed, time);
    case "candle": {
      // A candle is mostly steady with the occasional deep gutter, so a slow
      // wave decides WHETHER it is guttering and the fast noise decides how
      // far. Multiplying them keeps the flame quiet most of the time.
      const gutter = clamp01(
        Math.sin(time * 0.7 + modulation.seed * Math.PI * 2) * 0.5 + 0.5
      );
      return (
        1 - amount * gutter * gutter * placedLightNoise(modulation.seed, time)
      );
    }
    case "pulse":
      // An even breath, no noise at all: this is the one that should look
      // deliberate rather than alive.
      return (
        1 -
        amount *
          (Math.sin(time * 2 + modulation.seed * Math.PI * 2) * 0.5 + 0.5)
      );
  }
}

/**
 * The colour a light shows at this brightness.
 *
 * A dimming flame cools toward red, the way a real one does, so colour rides
 * on brightness rather than wandering on its own. `colorWobble` is how far it
 * is allowed to go; at zero the colour never changes.
 */
function shiftedColor(
  color: number,
  modulation: PlacedLightModulation,
  scale: number
): number {
  const wobble = clamp01(modulation.colorWobble);
  const cooling = wobble * (1 - scale);
  if (cooling === 0) return color;
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  // Toward red: green and blue give way, red holds.
  const nextGreen = Math.round(green * (1 - cooling * 0.5));
  const nextBlue = Math.round(blue * (1 - cooling));
  return (red << 16) | (nextGreen << 8) | nextBlue;
}

/**
 * What this light should be set to at this moment.
 *
 * Total: every behavior has an answer at every time, and a light that is not
 * moving answers with exactly what its author typed.
 */
export function samplePlacedLightModulation(
  light: PlacedLight,
  seconds: number
): PlacedLightModulationSample {
  const scale = clamp01(brightnessScale(light.modulation, seconds));
  return {
    intensity: light.intensity * scale,
    color: shiftedColor(light.color, light.modulation, scale)
  };
}
