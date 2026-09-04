/**
 * Applying one drag to each object in a selection, about a shared pivot.
 *
 * Move is pivot-independent. Rotate and scale change each object twice over:
 * its origin relative to the pivot, and the object itself.
 */

import { describe, expect, it } from "vitest";
import {
  applyDelta,
  axisScaleWouldShear,
  type Vector3Tuple
} from "@sugarmagic/workspaces";

const AT = (x: number, y: number, z: number) => ({
  position: [x, y, z] as Vector3Tuple,
  rotation: [0, 0, 0] as Vector3Tuple,
  scale: [1, 1, 1] as Vector3Tuple
});

const ORIGIN: Vector3Tuple = [0, 0, 0];

describe("applying a move", () => {
  it("shifts the object by the translation", () => {
    const moved = applyDelta(AT(1, 2, 3), ORIGIN, {
      mode: "move",
      translation: [10, 0, -5]
    });
    expect(moved.position).toEqual([11, 2, -2]);
  });

  it("ignores the pivot, because a translation is the same vector anywhere", () => {
    const near = applyDelta(AT(1, 2, 3), ORIGIN, {
      mode: "move",
      translation: [10, 0, 0]
    });
    const far = applyDelta(AT(1, 2, 3), [900, -400, 32], {
      mode: "move",
      translation: [10, 0, 0]
    });
    expect(near.position).toEqual(far.position);
  });

  it("leaves rotation and scale alone", () => {
    const moved = applyDelta(AT(1, 2, 3), ORIGIN, {
      mode: "move",
      translation: [1, 1, 1]
    });
    expect(moved.rotation).toEqual([0, 0, 0]);
    expect(moved.scale).toEqual([1, 1, 1]);
  });
});

describe("applying a rotation", () => {
  const QUARTER_TURN_ABOUT_Y = {
    mode: "rotate" as const,
    axis: [0, 1, 0] as Vector3Tuple,
    angle: Math.PI / 2
  };

  it("orbits the object's origin around the pivot", () => {
    // A quarter turn about Y takes +X to -Z.
    const turned = applyDelta(AT(5, 0, 0), ORIGIN, QUARTER_TURN_ABOUT_Y);
    expect(turned.position[0]).toBeCloseTo(0, 6);
    expect(turned.position[2]).toBeCloseTo(-5, 6);
  });

  it("turns the object itself as well as moving it", () => {
    const turned = applyDelta(AT(5, 0, 0), ORIGIN, QUARTER_TURN_ABOUT_Y);
    expect(turned.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("leaves an object sitting on the pivot where it is, but still turns it", () => {
    const turned = applyDelta(AT(0, 0, 0), ORIGIN, QUARTER_TURN_ABOUT_Y);
    expect(turned.position[0]).toBeCloseTo(0, 6);
    expect(turned.position[2]).toBeCloseTo(0, 6);
    expect(turned.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("orbits about the pivot given, not about the world origin", () => {
    const turned = applyDelta(AT(15, 0, 0), [10, 0, 0], QUARTER_TURN_ABOUT_Y);
    expect(turned.position[0]).toBeCloseTo(10, 6);
    expect(turned.position[2]).toBeCloseTo(-5, 6);
  });
});

describe("applying a scale", () => {
  const DOUBLE = {
    mode: "scale" as const,
    factor: [2, 2, 2] as Vector3Tuple
  };

  it("grows the object", () => {
    expect(applyDelta(AT(0, 0, 0), ORIGIN, DOUBLE).scale).toEqual([2, 2, 2]);
  });

  it("spreads the objects away from the pivot", () => {
    expect(applyDelta(AT(4, 0, 0), ORIGIN, DOUBLE).position).toEqual([8, 0, 0]);
  });

  it("spreads relative to the pivot given", () => {
    expect(applyDelta(AT(4, 0, 0), [2, 0, 0], DOUBLE).position).toEqual([
      6, 0, 0
    ]);
  });

  it("never collapses an object to nothing", () => {
    const crushed = applyDelta(AT(0, 0, 0), ORIGIN, {
      mode: "scale",
      factor: [0, 0, 0]
    });
    expect(crushed.scale[0]).toBeGreaterThan(0);
  });
});

describe("when axis scale would shear", () => {
  it("allows a single object, rotated or not", () => {
    // Its own origin is the pivot, so there is no spread to disagree with.
    expect(axisScaleWouldShear([])).toBe(false);
    expect(axisScaleWouldShear([[0, 1, 0]])).toBe(false);
  });

  it("allows several objects when none of them is rotated", () => {
    expect(
      axisScaleWouldShear([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ])
    ).toBe(false);
  });

  it("refuses when one object is rotated", () => {
    expect(
      axisScaleWouldShear([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0.7, 0]
      ])
    ).toBe(true);
  });

  it("refuses when every object shares the SAME rotation", () => {
    // The origins spread along world axes while each object scales along its
    // own, so objects agreeing with each other does not make the result right.
    expect(
      axisScaleWouldShear([
        [0, Math.PI / 4, 0],
        [0, Math.PI / 4, 0]
      ])
    ).toBe(true);
  });

  it("treats a full turn as unrotated, not as a rotation", () => {
    expect(
      axisScaleWouldShear([
        [0, 0, 0],
        [0, Math.PI * 2, 0]
      ])
    ).toBe(false);
  });

  it("spots a rotation about any axis", () => {
    for (const rotation of [
      [0.6, 0, 0],
      [0, 0.6, 0],
      [0, 0, 0.6]
    ] as Vector3Tuple[]) {
      expect(axisScaleWouldShear([[0, 0, 0], rotation])).toBe(true);
    }
  });
});
