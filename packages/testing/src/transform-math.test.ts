/**
 * Gizmo ray-math tests.
 *
 * The pure projection functions behind ray-based gizmo manipulation:
 * axis-parameter (move/scale), plane intersection + signed angle
 * (rotate), and their degenerate-configuration null returns.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  angleAroundAxis,
  axisParameterForRay,
  planePointForRay
} from "@sugarmagic/workspaces";

function ray(origin: [number, number, number], direction: [number, number, number]) {
  return {
    origin: new THREE.Vector3(...origin),
    direction: new THREE.Vector3(...direction).normalize()
  };
}

describe("gizmo ray math", () => {
  it("finds the axis parameter where the pointer ray crosses the axis", () => {
    // Ray pointing straight down at world (3, ?, 0), axis = world X
    // through the origin: closest point is x = 3.
    const parameter = axisParameterForRay(
      ray([3, 10, 0], [0, -1, 0]),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0)
    );
    expect(parameter).toBeCloseTo(3, 5);
  });

  it("tracks the cursor 1:1 as the ray sweeps along the axis", () => {
    const axisOrigin = new THREE.Vector3(5, 0, -2);
    const axis = new THREE.Vector3(0, 0, 1);
    const at = (z: number) =>
      axisParameterForRay(ray([5, 8, z], [0, -1, 0]), axisOrigin, axis);
    // Grab at z=1 (parameter 3 relative to origin z=-2), drag to z=4.
    expect(at(1)! - at(-2)!).toBeCloseTo(3, 5);
    expect(at(4)! - at(1)!).toBeCloseTo(3, 5);
  });

  it("returns null when looking straight down the axis", () => {
    // Ray direction parallel to the axis -- no stable closest point.
    const parameter = axisParameterForRay(
      ray([0, 0, 10], [0, 0, -1]),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1)
    );
    expect(parameter).toBeNull();
  });

  it("intersects the rotation plane and measures a signed quarter turn", () => {
    const center = new THREE.Vector3(0, 0, 0);
    const axis = new THREE.Vector3(0, 1, 0);
    const hitA = planePointForRay(ray([2, 5, 0], [0, -1, 0]), center, axis);
    const hitB = planePointForRay(ray([0, 5, -2], [0, -1, 0]), center, axis);
    expect(hitA).not.toBeNull();
    expect(hitB).not.toBeNull();
    expect(hitA!.x).toBeCloseTo(2, 5);
    expect(hitB!.z).toBeCloseTo(-2, 5);
    // +X swung to -Z is +90deg around +Y (right-hand rule).
    const angle = angleAroundAxis(hitA!, hitB!, axis);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
    // And the reverse sweep is negative.
    expect(angleAroundAxis(hitB!, hitA!, axis)).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("returns null for a ray parallel to the rotation plane", () => {
    const hit = planePointForRay(
      ray([0, 5, 10], [0, 0, -1]),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0)
    );
    expect(hit).toBeNull();
  });

  it("returns null for a plane behind the ray", () => {
    const hit = planePointForRay(
      ray([0, 5, 0], [0, 1, 0]),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0)
    );
    expect(hit).toBeNull();
  });
});
