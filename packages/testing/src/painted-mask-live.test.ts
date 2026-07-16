/**
 * Live painted-mask registry (Plan 068.8).
 *
 * The CPU scatter path samples freshly-painted pixels from this registry
 * (snapshotted at registration) instead of the async-reloading resolver
 * texture. Verifies addressing (with the V-flip), UV wrap, snapshot
 * isolation, the guards, and clear.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  clearLivePaintedMasks,
  registerLivePaintedMask,
  sampleLivePaintedMask
} from "@sugarmagic/render-web";

/**
 * Minimal HTMLCanvasElement stand-in: getImageData returns row-major
 * RGBA where each pixel's R channel is taken from `reds` (index =
 * y * width + x). `context` null / zero size simulate the guard paths.
 */
function stubCanvas(
  width: number,
  height: number,
  reds: number[],
  options: { context?: "none" } = {}
): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = reds[i] ?? 0;
    data[i * 4 + 3] = 255;
  }
  return {
    width,
    height,
    getContext: () =>
      options.context === "none"
        ? null
        : {
            getImageData: (_x: number, _y: number, w: number, h: number) => ({
              width: w,
              height: h,
              data
            })
          }
  } as unknown as HTMLCanvasElement;
}

afterEach(() => {
  clearLivePaintedMasks();
});

describe("sampleLivePaintedMask", () => {
  it("returns null for a mask that was never registered", () => {
    expect(sampleLivePaintedMask("little-world:mask-texture:absent", [0.5, 0.5])).toBeNull();
  });

  it("samples the R channel (0..1) with the texture V axis flipped", () => {
    // 2x2, row-major reds. Row y=0 is the TOP of the texture (v=1).
    //   (x0,y0)=10  (x1,y0)=20
    //   (x0,y1)=30  (x1,y1)=40
    registerLivePaintedMask("m", stubCanvas(2, 2, [10, 20, 30, 40]));

    // v near 1 -> top row (y=0); v near 0 -> bottom row (y=1).
    expect(sampleLivePaintedMask("m", [0.1, 0.9])).toBeCloseTo(10 / 255, 5);
    expect(sampleLivePaintedMask("m", [0.9, 0.9])).toBeCloseTo(20 / 255, 5);
    expect(sampleLivePaintedMask("m", [0.1, 0.1])).toBeCloseTo(30 / 255, 5);
    expect(sampleLivePaintedMask("m", [0.9, 0.1])).toBeCloseTo(40 / 255, 5);
  });

  it("wraps UVs outside [0,1) (positive and negative)", () => {
    registerLivePaintedMask("m", stubCanvas(2, 2, [10, 20, 30, 40]));
    // 1.1 wraps to 0.1, -0.9 wraps to 0.1 -> same pixel as [0.1, 0.9].
    expect(sampleLivePaintedMask("m", [1.1, 0.9])).toBeCloseTo(10 / 255, 5);
    expect(sampleLivePaintedMask("m", [-0.9, 0.9])).toBeCloseTo(10 / 255, 5);
  });

  it("snapshots pixels at registration time (later canvas edits do not leak in)", () => {
    const canvas = stubCanvas(1, 1, [100]);
    registerLivePaintedMask("m", canvas);
    // Mutate the backing store the stub handed out; the registry kept its
    // own getImageData copy, so the sample is unaffected.
    (canvas as unknown as { width: number }).width = 999;
    expect(sampleLivePaintedMask("m", [0.5, 0.5])).toBeCloseTo(100 / 255, 5);
  });

  it("ignores a zero-sized canvas (no entry registered)", () => {
    registerLivePaintedMask("m", stubCanvas(0, 0, []));
    expect(sampleLivePaintedMask("m", [0.5, 0.5])).toBeNull();
  });

  it("ignores a canvas with no 2D context", () => {
    registerLivePaintedMask("m", stubCanvas(2, 2, [10, 20, 30, 40], { context: "none" }));
    expect(sampleLivePaintedMask("m", [0.5, 0.5])).toBeNull();
  });

  it("clearLivePaintedMasks drops every entry", () => {
    registerLivePaintedMask("m", stubCanvas(1, 1, [100]));
    expect(sampleLivePaintedMask("m", [0.5, 0.5])).not.toBeNull();
    clearLivePaintedMasks();
    expect(sampleLivePaintedMask("m", [0.5, 0.5])).toBeNull();
  });
});
