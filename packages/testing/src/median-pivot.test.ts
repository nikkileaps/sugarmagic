import { describe, expect, it } from "vitest";
import { medianPivot, type Vector3Tuple } from "@sugarmagic/workspaces";

describe("median pivot", () => {
  it("has no pivot when nothing is selected", () => {
    expect(medianPivot([])).toBeNull();
  });

  it("sits on the object itself when one is selected", () => {
    expect(medianPivot([[3, 1, -4]])).toEqual([3, 1, -4]);
  });

  it("sits midway between two objects", () => {
    expect(
      medianPivot([
        [0, 0, 0],
        [4, 2, -6]
      ])
    ).toEqual([2, 1, -3]);
  });

  it("averages the origins of three objects", () => {
    expect(
      medianPivot([
        [0, 0, 0],
        [3, 0, 0],
        [6, 3, 9]
      ])
    ).toEqual([3, 1, 3]);
  });

  it("leans toward a cluster, because a mean is density-weighted", () => {
    const clustered: Vector3Tuple[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
      [90, 0, 0]
    ];
    const pivot = medianPivot(clustered);
    expect(pivot).not.toBeNull();
    // Halfway between the extremes would be 45; the mean is far short of it.
    expect(pivot![0]).toBeCloseTo(100 / 6);
    expect(pivot![0]).toBeLessThan(45);
  });

  it("ignores the order the objects were selected in", () => {
    const forward: Vector3Tuple[] = [
      [0, 0, 0],
      [3, 6, 9]
    ];
    expect(medianPivot(forward)).toEqual(medianPivot([...forward].reverse()));
  });
});
