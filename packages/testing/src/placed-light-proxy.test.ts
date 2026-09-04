/**
 * What Studio draws where a light is.
 *
 * Studio shows a light's coverage, not the light: a wire sphere, cone or
 * rectangle, plus a dot to grab it by. These pin the shapes and the one thing
 * that is easy to get backwards -- which way they point.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createPlacedLightProxy,
  PLACED_LIGHT_WIRE_COLOR
} from "@sugarmagic/render-web";
import { createPlacedLight } from "@sugarmagic/domain";

function wireOf(proxy: THREE.Object3D): THREE.Object3D {
  const wire = proxy.children.find(
    (child) =>
      child instanceof THREE.LineSegments || child instanceof THREE.LineLoop
  );
  expect(wire).toBeTruthy();
  return wire!;
}

function boundsOf(wire: THREE.Object3D): THREE.Box3 {
  const geometry = (wire as THREE.Line).geometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe("the proxy Studio draws for a placed light", () => {
  it("gives every light a grabbable dot, since a wire is unclickable", () => {
    const proxy = createPlacedLightProxy(createPlacedLight({ kind: "point" }));

    const dot = proxy.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh
    );
    expect(dot).toBeTruthy();
    expect(dot!.geometry).toBeInstanceOf(THREE.SphereGeometry);
  });

  it("draws one colour, whatever the kind", () => {
    for (const kind of ["point", "spot", "area"] as const) {
      const proxy = createPlacedLightProxy(createPlacedLight({ kind }));
      const material = (wireOf(proxy) as THREE.Line)
        .material as THREE.LineBasicMaterial;
      expect(material.color.getHex()).toBe(PLACED_LIGHT_WIRE_COLOR);
    }
  });

  it("draws a point light's reach as a sphere of its radius", () => {
    const proxy = createPlacedLightProxy(
      createPlacedLight({ kind: "point", radius: 5 })
    );

    const bounds = boundsOf(wireOf(proxy));
    expect(bounds.max.x).toBeCloseTo(5, 1);
    expect(bounds.min.y).toBeCloseTo(-5, 1);
  });

  it("hangs a spot light's cone below it, apex at the light", () => {
    const proxy = createPlacedLightProxy(
      createPlacedLight({
        kind: "spot",
        radius: 8,
        spot: { angleDeg: 45, penumbra: 0, projectedTextureId: null }
      })
    );

    const bounds = boundsOf(wireOf(proxy));
    // Apex at the light, mouth a full reach below it: an unrotated spot
    // points straight down, and nothing sits above the light.
    expect(bounds.max.y).toBeCloseTo(0, 5);
    expect(bounds.min.y).toBeCloseTo(-8, 5);
    // A 45 degree half-angle spreads as wide as it is deep.
    expect(bounds.max.x).toBeCloseTo(8, 1);
  });

  it("lays an area light's panel flat, at its authored size", () => {
    const proxy = createPlacedLightProxy(
      createPlacedLight({ kind: "area", area: { width: 4, height: 2 } })
    );

    const bounds = boundsOf(wireOf(proxy));
    expect(bounds.max.x).toBeCloseTo(2, 5);
    expect(bounds.max.z).toBeCloseTo(1, 5);
    // Flat: a panel has no thickness, and it faces the way the light emits.
    expect(bounds.max.y).toBeCloseTo(0, 5);
    expect(bounds.min.y).toBeCloseTo(0, 5);
  });
});
