/**
 * Mechanics stat runtime tests.
 *
 * Guards carrier initialization, bounds, recharge/decay, and subscriptions.
 */

import { describe, expect, it } from "vitest";
import { createStatCarrier } from "@sugarmagic/runtime-core";
import type { MechanicsDefinition } from "@sugarmagic/domain";

const mechanics: MechanicsDefinition = {
  stats: [
    {
      id: "energy",
      displayName: "Energy",
      default: 5,
      min: 0,
      max: 10,
      decay: null,
      recharge: { ratePerSecond: 2 },
      display: "bar",
      role: null
    }
  ],
  castables: []
};

describe("mechanics stat carriers", () => {
  it("clamps mutations and emits change events", () => {
    const carrier = createStatCarrier(mechanics);
    const events: string[] = [];
    carrier.subscribe((event) =>
      events.push(`${event.statId}:${event.previousValue}->${event.nextValue}`)
    );

    carrier.mutate("energy", 20);

    expect(carrier.get("energy")).toBe(10);
    expect(events).toEqual(["energy:5->10"]);
  });

  it("ticks authored recharge", () => {
    const carrier = createStatCarrier(mechanics);
    carrier.tick(2);
    expect(carrier.get("energy")).toBe(9);
  });
});
