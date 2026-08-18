/**
 * Geometry contract for the framed gameplay panels (caster and plain).
 *
 * Each frame is assembled from rectangles cut out of one painted sheet.
 * These tests pin the properties the DOM assembler relies on: cuts stay
 * inside their sheet, band segments fit their band, repeating slices exist,
 * and on the caster frame the top band tiles the full width with no dropped
 * pixels and the live meter overlays sit inside the painted pill troughs.
 */
import { describe, expect, it } from "vitest";
import {
  CASTER_FRAME_GEOMETRY,
  MEDALLION_CIRCLE,
  PLAIN_FRAME_GEOMETRY,
  REPEATING_SLICE_ART,
  clampRatio,
  frameHeightForContent,
  type FrameGeometry,
  type FrameSlice
} from "@sugarmagic/runtime-core";

const VARIANTS: Array<[string, FrameGeometry]> = [
  ["caster", CASTER_FRAME_GEOMETRY],
  ["plain", PLAIN_FRAME_GEOMETRY]
];

function insideSheet(geometry: FrameGeometry, slice: FrameSlice): boolean {
  return (
    slice.x0 >= 0 &&
    slice.y0 >= 0 &&
    slice.x1 <= geometry.sheet.width &&
    slice.y1 <= geometry.sheet.height &&
    slice.x0 < slice.x1 &&
    slice.y0 < slice.y1
  );
}

function width(slice: FrameSlice): number {
  return slice.x1 - slice.x0;
}

describe.each(VARIANTS)("%s frame geometry", (_variant, geometry) => {
  it("keeps every cut inside the sheet with positive area", () => {
    for (const [name, slice] of Object.entries(geometry.slices)) {
      expect(insideSheet(geometry, slice), `slice ${name} out of bounds`).toBe(
        true
      );
    }
  });

  it("frame width matches the corner cuts against the origin", () => {
    expect(geometry.slices["cornerTL"]!.x0).toBe(geometry.origin.x);
    expect(geometry.slices["cornerTR"]!.x1 - geometry.origin.x).toBe(
      geometry.frameWidth
    );
  });

  it("every band segment names an existing slice cut no taller than its band", () => {
    const bands: Array<[ReadonlyArray<{ slice: string }>, number]> = [
      [geometry.topBand, geometry.topBandHeight],
      [geometry.bottomBand, geometry.bottomBandHeight]
    ];
    for (const [band, bandHeight] of bands) {
      for (const segment of band) {
        const slice = geometry.slices[segment.slice];
        expect(slice, `band references missing slice ${segment.slice}`).toBeDefined();
        expect(slice!.y1 - slice!.y0).toBeLessThanOrEqual(bandHeight + 1);
      }
    }
  });

  it("declares every repeating slice the art files must supply", () => {
    for (const name of Object.keys(REPEATING_SLICE_ART)) {
      expect(
        geometry.slices[name],
        `repeating slice ${name} missing`
      ).toBeDefined();
    }
  });

  it("band fixed segments never exceed the frame width", () => {
    for (const band of [geometry.topBand, geometry.bottomBand]) {
      const total = band
        .filter((segment) => !segment.stretch)
        .reduce((sum, segment) => sum + width(geometry.slices[segment.slice]!), 0);
      expect(total).toBeLessThanOrEqual(geometry.frameWidth);
    }
  });

  it("content area clears the top band", () => {
    expect(geometry.contentInsets.top).toBeGreaterThanOrEqual(
      geometry.topBandHeight
    );
  });

  it("panel height never shrinks below natural and grows with content", () => {
    expect(frameHeightForContent(geometry, 0)).toBe(geometry.naturalHeight);
    const tall = frameHeightForContent(geometry, 2000);
    expect(tall).toBe(
      2000 + geometry.contentInsets.top + geometry.contentInsets.bottom
    );
  });
});

describe("caster top band", () => {
  const slices = CASTER_FRAME_GEOMETRY.slices;

  it("is contiguous: no source pixels dropped between fixed segments", () => {
    // A dropped span between segments deletes painted hardware (this bug
    // ate one of the medallion's flanking gems in the prototype).
    expect(slices["cornerTL"]!.x1).toBe(slices["topBattery"]!.x0);
    expect(slices["topBattery"]!.x1).toBe(slices["topMedallion"]!.x0);
    expect(slices["topMedallion"]!.x1).toBe(slices["topResonance"]!.x0);
    expect(slices["topResonance"]!.x1).toBe(slices["cornerTR"]!.x0);
  });

  it("fixed segments sum to the frame width, so stretch strips collapse at natural size", () => {
    const total = CASTER_FRAME_GEOMETRY.topBand
      .filter((segment) => !segment.stretch)
      .reduce((sum, segment) => sum + width(slices[segment.slice]!), 0);
    expect(total).toBe(CASTER_FRAME_GEOMETRY.frameWidth);
  });
});

describe("caster meter and medallion overlays", () => {
  const geometry = CASTER_FRAME_GEOMETRY;

  it("meter overlays sit inside the painted pill segments they cover", () => {
    // The overlay must fully cover the painted 100% fill (and its baked
    // label) while leaving the gold rim visible around it.
    const cases = [
      { rect: geometry.meters!.battery, slice: geometry.slices["topBattery"]! },
      { rect: geometry.meters!.resonance, slice: geometry.slices["topResonance"]! }
    ];
    for (const { rect, slice } of cases) {
      const sourceX0 = rect.x + geometry.origin.x;
      const sourceY0 = rect.y + geometry.origin.y;
      expect(sourceX0).toBeGreaterThan(slice.x0);
      expect(sourceX0 + rect.width).toBeLessThan(slice.x1);
      expect(sourceY0).toBeGreaterThan(slice.y0);
      expect(sourceY0 + rect.height).toBeLessThan(slice.y1);
    }
  });

  it("medallion circle sits inside the medallion cut", () => {
    const slice = geometry.slices["topMedallion"]!;
    const sourceCx = MEDALLION_CIRCLE.cx + geometry.origin.x;
    const sourceCy = MEDALLION_CIRCLE.cy + geometry.origin.y;
    expect(sourceCx - MEDALLION_CIRCLE.r).toBeGreaterThan(slice.x0);
    expect(sourceCx + MEDALLION_CIRCLE.r).toBeLessThan(slice.x1);
    expect(sourceCy - MEDALLION_CIRCLE.r).toBeGreaterThanOrEqual(slice.y0);
    expect(sourceCy + MEDALLION_CIRCLE.r).toBeLessThan(slice.y1);
  });
});

describe("plain frame", () => {
  it("has no meters", () => {
    expect(PLAIN_FRAME_GEOMETRY.meters).toBeNull();
  });
});

describe("meter math", () => {
  it("clamps ratios to the renderable range", () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(-0.2)).toBe(0);
    expect(clampRatio(1.7)).toBe(1);
    expect(clampRatio(Number.NaN)).toBe(0);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
