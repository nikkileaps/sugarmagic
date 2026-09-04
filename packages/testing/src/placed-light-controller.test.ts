/**
 * The three.js realization of an author's placed lights.
 *
 * Drives the controller against a bare scene, with no renderer: what it puts
 * in the scene graph, and — the part that matters for cost — what it mutates
 * rather than replaces.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createPlacedLightController } from "@sugarmagic/render-web";
import { createPlacedLight, type PlacedLight } from "@sugarmagic/domain";

function lightsIn(scene: THREE.Scene): THREE.Light[] {
  return scene.children.filter(
    (child): child is THREE.Light => child instanceof THREE.Light
  );
}

function onlyLight(scene: THREE.Scene): THREE.Light {
  const found = lightsIn(scene);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function lantern(overrides: Partial<PlacedLight> = {}): PlacedLight {
  return createPlacedLight({
    instanceId: "placed-light:lantern",
    displayName: "Lantern",
    color: 0xff0000,
    intensity: 12,
    radius: 7,
    transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...overrides
  });
}

describe("what a placed light puts in the scene", () => {
  it("realizes a point light with its authored colour, intensity and reach", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([lantern()]);

    const light = onlyLight(scene);
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect(light.color.getHex()).toBe(0xff0000);
    expect(light.intensity).toBe(12);
    expect(light.position.toArray()).toEqual([1, 2, 3]);
    expect((light as THREE.PointLight).distance).toBe(7);
  });

  it("pins decay to physical falloff, because intensity is candela", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([lantern()]);

    expect((onlyLight(scene) as THREE.PointLight).decay).toBe(2);
  });

  it("realizes a spot light with its authored cone", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([
      lantern({
        kind: "spot",
        spot: { angleDeg: 30, penumbra: 0.5, projectedTextureId: null }
      })
    ]);

    const light = onlyLight(scene) as THREE.SpotLight;
    expect(light).toBeInstanceOf(THREE.SpotLight);
    expect(light.angle).toBeCloseTo(30 * THREE.MathUtils.DEG2RAD, 6);
    expect(light.penumbra).toBe(0.5);
  });

  it("points an unrotated spot light straight down, the way a lamp hangs", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([
      lantern({
        kind: "spot",
        spot: { angleDeg: 30, penumbra: 0, projectedTextureId: null }
      })
    ]);

    const light = onlyLight(scene) as THREE.SpotLight;
    expect(light.target.position.toArray()).toEqual([1, 1, 3]);
  });

  it("aims a rotated spot light where the author turned it", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([
      lantern({
        kind: "spot",
        spot: { angleDeg: 30, penumbra: 0, projectedTextureId: null },
        // A quarter turn about X tips "straight down" onto the -Z axis.
        transform: {
          position: [0, 0, 0],
          rotation: [Math.PI / 2, 0, 0],
          scale: [1, 1, 1]
        }
      })
    ]);

    const light = onlyLight(scene) as THREE.SpotLight;
    const aim = light.target.position;
    expect(aim.x).toBeCloseTo(0, 6);
    expect(aim.y).toBeCloseTo(0, 6);
    expect(aim.z).toBeCloseTo(-1, 6);
  });

  it("realizes an area light with its authored rectangle and no reach cutoff", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([
      lantern({ kind: "area", area: { width: 3, height: 5 } })
    ]);

    const light = onlyLight(scene) as THREE.RectAreaLight;
    expect(light).toBeInstanceOf(THREE.RectAreaLight);
    expect(light.width).toBe(3);
    expect(light.height).toBe(5);
  });

  it("casts no shadows, whatever the kind", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([
      lantern({ instanceId: "a", kind: "point" }),
      lantern({
        instanceId: "b",
        kind: "spot",
        spot: { angleDeg: 30, penumbra: 0, projectedTextureId: null }
      })
    ]);

    for (const light of lightsIn(scene)) {
      expect(light.castShadow).toBe(false);
    }
  });
});

describe("what changes and what is left alone", () => {
  it("mutates a light in place rather than replacing it", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([lantern()]);
    const before = onlyLight(scene);

    controller.apply([lantern({ intensity: 40, color: 0x00ff00 })]);
    const after = onlyLight(scene);

    // Adding or removing a light recompiles every material in the scene,
    // because three bakes the light count into the shader cache key. Writing
    // colour and intensity onto the light already there is free. If this ever
    // fails, an animated light costs a recompile per frame.
    expect(Object.is(before, after)).toBe(true);
    expect(after.intensity).toBe(40);
    expect(after.color.getHex()).toBe(0x00ff00);
  });

  it("moves a light in place too", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([lantern()]);
    const before = onlyLight(scene);

    controller.apply([
      lantern({
        transform: {
          position: [9, 9, 9],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      })
    ]);

    expect(Object.is(before, onlyLight(scene))).toBe(true);
    expect(onlyLight(scene).position.toArray()).toEqual([9, 9, 9]);
  });

  it("swaps the light when its kind changes, since the class differs", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([lantern({ kind: "point" })]);
    controller.apply([
      lantern({
        kind: "spot",
        spot: { angleDeg: 30, penumbra: 0, projectedTextureId: null }
      })
    ]);

    expect(onlyLight(scene)).toBeInstanceOf(THREE.SpotLight);
  });

  it("keeps a light out of the scene entirely while it is switched off", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([lantern({ enabled: false })]);
    expect(lightsIn(scene)).toHaveLength(0);

    controller.apply([lantern({ enabled: true })]);
    expect(lightsIn(scene)).toHaveLength(1);
  });

  it("takes a light out when it stops being placed", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([lantern()]);
    controller.apply([]);

    expect(lightsIn(scene)).toHaveLength(0);
  });

  it("takes a spot light's aim object out with it", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([
      lantern({
        kind: "spot",
        spot: { angleDeg: 30, penumbra: 0, projectedTextureId: null }
      })
    ]);
    const withLight = scene.children.length;
    controller.apply([]);

    expect(withLight).toBeGreaterThan(scene.children.length);
    expect(scene.children).toHaveLength(0);
  });

  it("holds every placed light at once, region's and Scene's alike", () => {
    const scene = new THREE.Scene();

    createPlacedLightController(scene).apply([
      lantern({ instanceId: "placed-light:region" }),
      lantern({ instanceId: "placed-light:scene" })
    ]);

    expect(lightsIn(scene)).toHaveLength(2);
  });

  it("empties the scene when cleared", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene);

    controller.apply([lantern()]);
    controller.clear();

    expect(lightsIn(scene)).toHaveLength(0);
  });
});
