/**
 * When a region has too many lights to stay smooth.
 *
 * The threshold is a measurement, not a preference -- see
 * `MAX_COMFORTABLE_PLACED_LIGHTS` for the sweep that produced it. What these
 * pin is the rule around it: what counts, what does not, and that the warning
 * arrives one light past the budget rather than at it.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_COMFORTABLE_PLACED_LIGHTS,
  placedLightBudgetWarning
} from "@sugarmagic/runtime-core";
import { createPlacedLight, type PlacedLight } from "@sugarmagic/domain";

function lights(count: number, enabled = true): PlacedLight[] {
  return Array.from({ length: count }, (_, index) =>
    createPlacedLight({ instanceId: `placed-light:${index}`, enabled })
  );
}

describe("the light budget warning", () => {
  it("says nothing about a region with no lights", () => {
    expect(placedLightBudgetWarning([])).toBeNull();
  });

  it("says nothing right up to the budget", () => {
    expect(
      placedLightBudgetWarning(lights(MAX_COMFORTABLE_PLACED_LIGHTS))
    ).toBeNull();
  });

  it("speaks up one light past it", () => {
    const warning = placedLightBudgetWarning(
      lights(MAX_COMFORTABLE_PLACED_LIGHTS + 1)
    );
    expect(warning).toContain(String(MAX_COMFORTABLE_PLACED_LIGHTS + 1));
  });

  it("ignores lights that are switched off, which are not in the scene at all", () => {
    expect(
      placedLightBudgetWarning([
        ...lights(MAX_COMFORTABLE_PLACED_LIGHTS),
        ...lights(50, false)
      ])
    ).toBeNull();
  });

  it("counts only what is lit, when a region holds both", () => {
    const warning = placedLightBudgetWarning([
      ...lights(MAX_COMFORTABLE_PLACED_LIGHTS + 3),
      ...lights(10, false)
    ]);
    expect(warning).toContain(String(MAX_COMFORTABLE_PLACED_LIGHTS + 3));
  });
});
