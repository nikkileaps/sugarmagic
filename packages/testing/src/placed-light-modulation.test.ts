/**
 * How a placed light moves over time.
 *
 * The behaviours are pure functions of elapsed seconds and a seed, which is
 * what makes them testable at all: a flame has one right answer at t = 3.2s,
 * and it is the same answer on every run.
 */

import { describe, expect, it } from "vitest";
import {
  placedLightNoise,
  samplePlacedLightModulation
} from "@sugarmagic/runtime-core";
import {
  createPlacedLight,
  type PlacedLightModulation
} from "@sugarmagic/domain";

const MOVING: Omit<PlacedLightModulation, "kind"> = {
  speed: 1,
  amount: 0.5,
  colorWobble: 0,
  seed: 0.25
};

function light(modulation: Partial<PlacedLightModulation>) {
  return createPlacedLight({
    intensity: 10,
    color: 0xffffff,
    modulation: { kind: "flame", ...MOVING, ...modulation }
  });
}

/** Intensity across a run of moments, for judging the shape of a behaviour. */
function overTime(
  modulation: Partial<PlacedLightModulation>,
  seconds: number[]
): number[] {
  const subject = light(modulation);
  return seconds.map(
    (at) => samplePlacedLightModulation(subject, at).intensity
  );
}

const SAMPLE_TIMES = [0, 0.4, 1.1, 2.3, 3.2, 5.7, 9.4];

describe("a light that is not moving", () => {
  it("shows exactly what its author typed, at every moment", () => {
    for (const value of overTime({ kind: "steady" }, SAMPLE_TIMES)) {
      expect(value).toBe(10);
    }
  });

  it("keeps its colour, whatever the drift is set to", () => {
    const subject = light({ kind: "steady", colorWobble: 1 });
    expect(samplePlacedLightModulation(subject, 4.5).color).toBe(0xffffff);
  });
});

describe("a light that is moving", () => {
  it("gives the same answer at the same moment, every time", () => {
    const subject = light({ kind: "flame" });
    expect(samplePlacedLightModulation(subject, 3.2).intensity).toBe(
      samplePlacedLightModulation(subject, 3.2).intensity
    );
  });

  it("never brightens past what its author typed", () => {
    for (const kind of ["flame", "candle", "pulse"] as const) {
      for (const value of overTime({ kind, amount: 1 }, SAMPLE_TIMES)) {
        expect(value).toBeLessThanOrEqual(10);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("swings no further than the amount allows", () => {
    for (const kind of ["flame", "candle", "pulse"] as const) {
      for (const value of overTime({ kind, amount: 0.2 }, SAMPLE_TIMES)) {
        // At most a fifth off full, so a small amount stays subtle.
        expect(value).toBeGreaterThanOrEqual(10 * 0.8 - 1e-9);
      }
    }
  });

  it("holds still when the amount is zero", () => {
    for (const kind of ["flame", "candle", "pulse"] as const) {
      for (const value of overTime({ kind, amount: 0 }, SAMPLE_TIMES)) {
        expect(value).toBeCloseTo(10, 9);
      }
    }
  });

  it("actually moves, rather than sitting at one value", () => {
    for (const kind of ["flame", "candle", "pulse"] as const) {
      const values = overTime({ kind }, SAMPLE_TIMES);
      expect(new Set(values).size).toBeGreaterThan(1);
    }
  });
});

describe("two lights side by side", () => {
  it("do not move together when their seeds differ", () => {
    const first = light({ seed: 0.1 });
    const second = light({ seed: 0.8 });

    const apart = SAMPLE_TIMES.some(
      (at) =>
        Math.abs(
          samplePlacedLightModulation(first, at).intensity -
            samplePlacedLightModulation(second, at).intensity
        ) > 0.01
    );
    expect(apart).toBe(true);
  });

  it("move together when their seeds match, which is why a seed exists", () => {
    const first = light({ seed: 0.4 });
    const second = light({ seed: 0.4 });

    for (const at of SAMPLE_TIMES) {
      expect(samplePlacedLightModulation(first, at).intensity).toBe(
        samplePlacedLightModulation(second, at).intensity
      );
    }
  });
});

describe("colour riding on brightness", () => {
  it("leaves the colour alone when the drift is zero", () => {
    for (const at of SAMPLE_TIMES) {
      expect(samplePlacedLightModulation(light({}), at).color).toBe(0xffffff);
    }
  });

  it("cools toward red as the light dims", () => {
    const subject = light({ colorWobble: 1, amount: 1 });
    const dimmest = SAMPLE_TIMES.map((at) =>
      samplePlacedLightModulation(subject, at)
    ).sort((a, b) => a.intensity - b.intensity)[0]!;

    const red = (dimmest.color >> 16) & 0xff;
    const blue = dimmest.color & 0xff;
    // Red holds while blue gives way, which is what a cooling flame does.
    expect(red).toBe(0xff);
    expect(blue).toBeLessThan(0xff);
  });
});

describe("the flicker curve itself", () => {
  it("stays inside 0 and 1, so a behaviour can trust it", () => {
    for (let at = 0; at < 20; at += 0.13) {
      const value = placedLightNoise(0.37, at);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("does not repeat itself over a short span", () => {
    // A curve with a short period reads as a strobe rather than as fire.
    const samples = new Set(
      Array.from({ length: 40 }, (_, step) =>
        placedLightNoise(0.37, step * 0.25).toFixed(4)
      )
    );
    expect(samples.size).toBeGreaterThan(35);
  });
});
