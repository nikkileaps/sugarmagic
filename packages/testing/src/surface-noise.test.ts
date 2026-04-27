/**
 * Surface noise helper tests.
 *
 * Verifies the shared CPU-side procedural noise helper stays deterministic,
 * bounded, and spatially smooth enough for authoring previews and scatter
 * mask evaluation.
 */

import { describe, expect, it } from "vitest";
import { samplePerlinNoise2d } from "@sugarmagic/domain";

describe("samplePerlinNoise2d", () => {
  it("is deterministic, bounded, and varies smoothly across nearby samples", () => {
    const a = samplePerlinNoise2d({ x: 1.25, y: 3.5 });
    const b = samplePerlinNoise2d({ x: 1.25, y: 3.5 });
    const nearby = samplePerlinNoise2d({ x: 1.27, y: 3.48 });
    const far = samplePerlinNoise2d({ x: 8.75, y: 0.5 });

    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(b).toBe(a);
    expect(Math.abs(a - nearby)).toBeLessThan(0.15);
    expect(Math.abs(a - far)).toBeGreaterThan(0.01);
  });
});
