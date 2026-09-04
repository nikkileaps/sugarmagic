/**
 * What Studio draws where a light is.
 *
 * Studio shows a light's coverage, not the light: a wire sphere, cone or
 * rectangle, plus a dot to grab it by. These pin the shapes and the one thing
 * that is easy to get backwards -- which way they point.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createPlacedLightProxy } from "@sugarmagic/render-web";
import { createPlacedLight } from "@sugarmagic/domain";

function wireOf(proxy: THREE.Object3D): THREE.Object3D {
  const wire = proxy.children.find((child) => child instanceof THREE.Line);
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

  it("draws every wire with something the renderer can actually draw", () => {
    // The WebGPU renderer refuses a LineLoop and logs instead of drawing. A
    // closed rectangle has to be a Line whose last point repeats its first.
    for (const kind of ["point", "spot", "area"] as const) {
      const wire = wireOf(createPlacedLightProxy(createPlacedLight({ kind })));
      expect(wire).not.toBeInstanceOf(THREE.LineLoop);
      expect(wire).toBeInstanceOf(THREE.Line);
    }
  });

  it("closes the area light's rectangle, since a Line does not close itself", () => {
    const proxy = createPlacedLightProxy(
      createPlacedLight({ kind: "area", area: { width: 4, height: 2 } })
    );

    const points = (wireOf(proxy) as THREE.Line).geometry.getAttribute(
      "position"
    );
    expect(points.count).toBe(5);
    expect([points.getX(0), points.getY(0), points.getZ(0)]).toEqual([
      points.getX(4),
      points.getY(4),
      points.getZ(4)
    ]);
  });

  it("draws the wire in the light's own colour, whatever the kind", () => {
    // Studio never builds the light, so the wire is the only place a colour
    // choice shows before previewing the game.
    for (const kind of ["point", "spot", "area"] as const) {
      const proxy = createPlacedLightProxy(
        createPlacedLight({ kind, color: 0x3366ff })
      );
      const material = (wireOf(proxy) as THREE.Line)
        .material as THREE.LineBasicMaterial;
      expect(material.color.getHex()).toBe(0x3366ff);
    }
  });

  it("dims a switched-off light without hiding it", () => {
    const on = createPlacedLightProxy(
      createPlacedLight({ color: 0xffffff, enabled: true })
    );
    const off = createPlacedLightProxy(
      createPlacedLight({ color: 0xffffff, enabled: false })
    );

    const brightness = (proxy: THREE.Object3D) =>
      ((wireOf(proxy) as THREE.Line).material as THREE.LineBasicMaterial).color
        .r;
    // Dimmer, so off reads at a glance; still drawn, so it can be found and
    // switched back on.
    expect(brightness(off)).toBeLessThan(brightness(on));
    expect(brightness(off)).toBeGreaterThan(0);
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
