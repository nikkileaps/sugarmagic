/**
 * Geometry contract for the framed gameplay panel (caster / item UI frame).
 *
 * The frame is assembled from rectangles cut out of one painted sheet. These
 * tests pin the properties the DOM assembler relies on: cuts stay inside the
 * sheet, the top band tiles the full frame width with no dropped pixels, and
 * the live meter overlays sit inside the painted pill troughs they cover.
 */
import { describe, expect, it } from "vitest";
import {
  CONTENT_INSETS,
  FRAME_NATURAL_HEIGHT,
  FRAME_ORIGIN,
  FRAME_SHEET,
  FRAME_SLICES,
  FRAME_WIDTH,
  MEDALLION_CIRCLE,
  METER_RECTS,
  TOP_BAND_HEIGHT,
  bottomBandSegments,
  clampRatio,
  frameHeightForContent,
  sliceWidth,
  topBandSegments,
  type FrameSlice
} from "@sugarmagic/runtime-core";

function insideSheet(slice: FrameSlice): boolean {
  return (
    slice.x0 >= 0 &&
    slice.y0 >= 0 &&
    slice.x1 <= FRAME_SHEET.width &&
    slice.y1 <= FRAME_SHEET.height &&
    slice.x0 < slice.x1 &&
    slice.y0 < slice.y1
  );
}

describe("framed panel slice table", () => {
  it("keeps every cut inside the sheet with positive area", () => {
    for (const [name, slice] of Object.entries(FRAME_SLICES)) {
      expect(insideSheet(slice), `slice ${name} out of bounds`).toBe(true);
    }
  });

  it("frame width matches the sheet minus its empty margins", () => {
    expect(FRAME_SLICES.cornerTL.x0).toBe(FRAME_ORIGIN.x);
    expect(FRAME_SLICES.cornerTR.x1 - FRAME_ORIGIN.x).toBe(FRAME_WIDTH);
  });
});

describe("top band composition", () => {
  it("caster band (meters shown) is contiguous: no source pixels dropped", () => {
    // A dropped span between segments deletes painted hardware (this bug
    // ate one of the medallion's flanking gems in the prototype).
    expect(FRAME_SLICES.cornerTL.x1).toBe(FRAME_SLICES.topBattery.x0);
    expect(FRAME_SLICES.topBattery.x1).toBe(FRAME_SLICES.topMedallion.x0);
    expect(FRAME_SLICES.topMedallion.x1).toBe(FRAME_SLICES.topResonance.x0);
    expect(FRAME_SLICES.topResonance.x1).toBe(FRAME_SLICES.cornerTR.x0);
  });

  it("caster band fixed segments sum to the frame width, so stretch strips collapse at natural size", () => {
    const fixed = topBandSegments(true).filter((segment) => !segment.stretch);
    const total = fixed.reduce(
      (sum, segment) => sum + sliceWidth(segment.slice),
      0
    );
    expect(total).toBe(FRAME_WIDTH);
  });

  it("item band (meters hidden) omits the battery and resonance hardware but keeps corners and medallion", () => {
    const names = topBandSegments(false)
      .filter((segment) => !segment.stretch)
      .map((segment) => segment.slice);
    expect(names).toEqual(["cornerTL", "topMedallion", "cornerTR"]);
  });

  it("every band segment uses a cut of the band's height", () => {
    for (const segment of topBandSegments(true)) {
      const slice = FRAME_SLICES[segment.slice];
      expect(slice.y0).toBe(FRAME_ORIGIN.y);
      expect(slice.y1 - slice.y0).toBeLessThanOrEqual(TOP_BAND_HEIGHT + 1);
    }
  });
});

describe("bottom band composition", () => {
  it("fixed segments fit inside the frame width, leaving room for the stretch rails", () => {
    const fixed = bottomBandSegments().filter((segment) => !segment.stretch);
    const total = fixed.reduce(
      (sum, segment) => sum + sliceWidth(segment.slice),
      0
    );
    expect(total).toBeLessThan(FRAME_WIDTH);
  });
});

describe("meter and medallion overlays", () => {
  it("meter overlays sit inside the painted pill segments they cover", () => {
    // The overlay must fully cover the painted 100% fill (and its baked
    // label) while leaving the gold rim visible around it.
    const batterySlice = FRAME_SLICES.topBattery;
    const resonanceSlice = FRAME_SLICES.topResonance;
    const cases = [
      { rect: METER_RECTS.battery, slice: batterySlice },
      { rect: METER_RECTS.resonance, slice: resonanceSlice }
    ];
    for (const { rect, slice } of cases) {
      const sourceX0 = rect.x + FRAME_ORIGIN.x;
      const sourceY0 = rect.y + FRAME_ORIGIN.y;
      expect(sourceX0).toBeGreaterThan(slice.x0);
      expect(sourceX0 + rect.width).toBeLessThan(slice.x1);
      expect(sourceY0).toBeGreaterThan(slice.y0);
      expect(sourceY0 + rect.height).toBeLessThan(slice.y1);
    }
  });

  it("medallion circle sits inside the medallion cut", () => {
    const slice = FRAME_SLICES.topMedallion;
    const sourceCx = MEDALLION_CIRCLE.cx + FRAME_ORIGIN.x;
    const sourceCy = MEDALLION_CIRCLE.cy + FRAME_ORIGIN.y;
    expect(sourceCx - MEDALLION_CIRCLE.r).toBeGreaterThan(slice.x0);
    expect(sourceCx + MEDALLION_CIRCLE.r).toBeLessThan(slice.x1);
    expect(sourceCy - MEDALLION_CIRCLE.r).toBeGreaterThanOrEqual(slice.y0);
    expect(sourceCy + MEDALLION_CIRCLE.r).toBeLessThan(slice.y1);
  });

  it("content area clears the top hardware overhang", () => {
    expect(CONTENT_INSETS.top).toBeGreaterThanOrEqual(TOP_BAND_HEIGHT);
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

describe("panel height", () => {
  it("never shrinks below the natural frame height", () => {
    expect(frameHeightForContent(0)).toBe(FRAME_NATURAL_HEIGHT);
  });

  it("grows with content past the natural height", () => {
    const tall = frameHeightForContent(2000);
    expect(tall).toBe(2000 + CONTENT_INSETS.top + CONTENT_INSETS.bottom);
  });
});
