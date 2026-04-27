/**
 * Billboard math tests.
 *
 * Verifies the isolated cylindrical-billboard math used by Story 36.17's
 * scatter billboard bin.
 */

import { describe, expect, it } from "vitest";
import { computeBillboardWorldPosition } from "@sugarmagic/render-web";

describe("billboard math", () => {
  it("keeps an upright card facing a camera looking from +Z", () => {
    const position = computeBillboardWorldPosition(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 2, z: 10 }
    );

    expect(position.x).toBeCloseTo(1, 4);
    expect(position.y).toBeCloseTo(0, 4);
    expect(position.z).toBeCloseTo(0, 4);
  });

  it("rotates the right-side vertex when the camera moves 90 degrees", () => {
    const position = computeBillboardWorldPosition(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 2, z: 0 }
    );

    expect(position.x).toBeCloseTo(0, 4);
    expect(position.y).toBeCloseTo(0, 4);
    expect(position.z).toBeCloseTo(-1, 4);
  });
});
