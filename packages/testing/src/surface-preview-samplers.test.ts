import { describe, expect, it } from "vitest";
import { createSurfacePreviewGeometry } from "../../../apps/studio/src/viewport/surface-preview-samplers";

describe("surface preview samplers", () => {
  it("builds upward-facing plane samples", () => {
    const spec = createSurfacePreviewGeometry("plane");
    const samples = spec.scatterSamplesForDensity(1);

    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((sample) => sample.normal[1] > 0.99)).toBe(true);
  });

  it("builds cube samples across multiple face normals", () => {
    const spec = createSurfacePreviewGeometry("cube");
    const samples = spec.scatterSamplesForDensity(1);
    const uniqueNormals = new Set(
      samples.map((sample) =>
        sample.normal.map((value) => Math.round(value)).join(",")
      )
    );

    expect(uniqueNormals.size).toBeGreaterThanOrEqual(6);
  });

  it("builds sphere samples on a normalized shell", () => {
    const spec = createSurfacePreviewGeometry("sphere");
    const samples = spec.scatterSamplesForDensity(0.5);

    expect(samples.length).toBeGreaterThan(0);
    expect(
      samples.every((sample) => {
        const normalLength = Math.hypot(...sample.normal);
        return Math.abs(normalLength - 1) < 0.0001;
      })
    ).toBe(true);
  });
});
