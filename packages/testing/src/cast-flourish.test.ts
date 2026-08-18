/**
 * Pure math behind the spell-cast flourish (caster/cast-flourish.ts): the
 * four-point star polygon and the burst scatter directions. The DOM
 * sequence itself is presentation and is verified by eye; these pin the
 * geometry it is built on.
 */
import { describe, expect, it } from "vitest";
import {
  CAST_FLOURISH_TIMINGS,
  burstDirections,
  fourPointStarPoints,
  hash01
} from "@sugarmagic/runtime-core";

describe("four-point star polygon", () => {
  it("has eight vertices", () => {
    const points = fourPointStarPoints(12, 12, 10, 3).split(" ");
    expect(points).toHaveLength(8);
  });

  it("is symmetric around its center", () => {
    const cx = 12;
    const cy = 12;
    const vertices = fourPointStarPoints(cx, cy, 10, 3)
      .split(" ")
      .map((pair) => pair.split(",").map(Number) as [number, number]);
    // Every vertex has a mirror through the center.
    for (const [x, y] of vertices) {
      const mirrored = vertices.some(
        ([mx, my]) =>
          Math.abs(mx - (2 * cx - x)) < 0.01 && Math.abs(my - (2 * cy - y)) < 0.01
      );
      expect(mirrored).toBe(true);
    }
  });

  it("spikes reach the outer radius on the axes", () => {
    const vertices = fourPointStarPoints(0, 0, 10, 3)
      .split(" ")
      .map((pair) => pair.split(",").map(Number) as [number, number]);
    expect(vertices).toContainEqual([0, -10]);
    expect(vertices).toContainEqual([10, 0]);
    expect(vertices).toContainEqual([0, 10]);
    expect(vertices).toContainEqual([-10, 0]);
  });
});

describe("burst directions", () => {
  it("returns the requested number of unit vectors", () => {
    const directions = burstDirections(7);
    expect(directions).toHaveLength(7);
    for (const { x, y } of directions) {
      expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
    }
  });

  it("spaces the vectors evenly around the circle", () => {
    const directions = burstDirections(6);
    const angles = directions
      .map(({ x, y }) => Math.atan2(y, x))
      .map((a) => (a + 2 * Math.PI) % (2 * Math.PI))
      .sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]! - angles[i - 1]!).toBeCloseTo((2 * Math.PI) / 6, 6);
    }
  });

  it("sends no star straight up", () => {
    // Screen-up is (0, -1); an axis-aligned scatter reads mechanical.
    for (const count of [5, 6, 7, 8]) {
      for (const { x, y } of burstDirections(count)) {
        const isStraightUp = Math.abs(x) < 0.01 && y < 0;
        expect(isStraightUp).toBe(false);
      }
    }
  });
});

describe("hash01", () => {
  it("is deterministic and stays in [0, 1)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const value = hash01(seed);
      expect(value).toBe(hash01(seed));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("varies across seeds", () => {
    const values = new Set(
      Array.from({ length: 50 }, (_, seed) => hash01(seed).toFixed(6))
    );
    expect(values.size).toBeGreaterThan(45);
  });
});

describe("timings", () => {
  it("phases fit inside the hard bound the promise resolves by", () => {
    const T = CAST_FLOURISH_TIMINGS;
    expect(T.press + T.charge + T.grow + T.burst).toBeLessThanOrEqual(T.total);
  });
});
