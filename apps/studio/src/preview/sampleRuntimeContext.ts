/**
 * Studio sample runtime UI context for target-embedded UI preview.
 *
 * The preview does not fake rendering, but it does need placeholder runtime
 * values so authored bindings like player.battery and region.name are visible
 * before the game is running.
 */

import type { RuntimeUIContext } from "@sugarmagic/runtime-core";

export function createSampleRuntimeUIContext(): Partial<RuntimeUIContext> {
  return {
    player: {
      battery: 0.65,
      maxBattery: 1,
      health: 1,
      position: [2, 0, 4.8]
    },
    region: {
      id: "sample-region",
      name: "Sample Region"
    },
    game: {
      visibleMenuKey: null,
      isPaused: false
    }
  };
}
