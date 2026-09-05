/**
 * How many lights a region can carry before the frame suffers.
 *
 * three.js does no light culling: every light in the scene is evaluated by
 * every lit pixel, however far away it is. So the cost is not "a light in the
 * corner nobody looks at" -- it is paid across the whole screen, by every
 * light, on every frame.
 */

import type { PlacedLight } from "./index";

/**
 * The most lights a region can hold before frame time leaves the floor.
 *
 * MEASURED, not chosen. `pnpm --filter @sugarmagic/perf-harness
 * probe:light-budget` walks a light-count sweep on real hardware; run
 * 2026-09-04 on the development Mac, at native pixel ratio, against a
 * screen-filling field of `MeshStandardNodeMaterial` boxes:
 *
 *     lights   median ms   vs 0 lights
 *         14        8.2        1.00x
 *         16        8.3        1.01x
 *         18        8.4        1.02x
 *         20       16.9        2.05x
 *         22       25.1        3.06x
 *         24       33.3        4.06x
 *         32       82.8        9.97x
 *         64      348.0       41.92x
 *
 * Flat at the display's refresh floor through 18, then it doubles at 20 and
 * climbs steeply. So 18 is the last count that costs nothing, and one more
 * than that is where an author deserves to be told.
 *
 * The measured scene is deliberately unkind -- every pixel lit, every light in
 * frame -- so a real region has more room than this, not less. A weaker
 * machine has less: re-run the sweep there and lower this if the game is meant
 * for one.
 *
 * The escape valve, if a project genuinely needs more: three's `TiledLighting`
 * addon handles point lights in a clustered pass rather than one-by-one. It
 * drops their shadows, which costs us nothing -- placed lights do not cast --
 * and it does not cover spot or area lights.
 */
export const MAX_COMFORTABLE_PLACED_LIGHTS = 18;

/**
 * What to tell an author about this region's light count, or null when there
 * is nothing worth saying.
 *
 * Counts only lights that are switched on: a light turned off is absent from
 * the scene entirely, so it costs nothing and should not be complained about.
 */
export function placedLightBudgetWarning(
  lights: readonly PlacedLight[]
): string | null {
  const lit = lights.filter((light) => light.enabled).length;
  if (lit <= MAX_COMFORTABLE_PLACED_LIGHTS) return null;
  return `${lit} lights are on in this region. Past ${MAX_COMFORTABLE_PLACED_LIGHTS} the frame rate starts to drop, because every light is paid for by every lit pixel.`;
}
