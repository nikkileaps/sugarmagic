/**
 * What a placed light looks like while you are authoring it.
 *
 * Studio draws the shape of a light's coverage rather than the light itself:
 * a wire sphere for a point light's reach, a wire cone for a spot's throw, a
 * wire rectangle for an area light's panel -- the shapes Blender draws, for
 * the same reason. The lit result is what the game shows.
 *
 * Every proxy is built pointing the way an unrotated light emits, straight
 * down, so the renderable's own transform orients it and the wire agrees with
 * the light by construction rather than by a second rotation rule.
 *
 * Nothing here is lit: line materials and an unlit centre marker, so a proxy
 * reads the same whatever the sun is doing.
 */

import * as THREE from "three";
import type { PlacedLight } from "@sugarmagic/domain";

/**
 * How much of its colour a switched-off light keeps. Dark enough to read as
 * off at a glance, bright enough to find and click so it can be switched back
 * on.
 */
const DISABLED_WIRE_DIM = 0.25;

/**
 * A proxy is drawn in the light's own colour, so choosing a warm tone or a cold
 * one is visible while authoring even though Studio never builds the light
 * itself.
 */
function wireColor(light: PlacedLight): THREE.Color {
  const color = new THREE.Color(light.color);
  return light.enabled ? color : color.multiplyScalar(DISABLED_WIRE_DIM);
}

/** The grabbable dot at the light's position. A wire is nearly impossible to
 *  click; this is what the raycast hits, as in Blender. */
const CENTRE_MARKER_RADIUS = 0.15;

/** Enough segments to read as round without drawing a net. */
const RADIAL_SEGMENTS = 16;

/** A point light reaches the same distance in every direction. */
function buildPointWire(
  radius: number,
  material: THREE.LineBasicMaterial
): THREE.Object3D {
  return new THREE.LineSegments(
    new THREE.WireframeGeometry(
      new THREE.SphereGeometry(radius, RADIAL_SEGMENTS, 8)
    ),
    material
  );
}

/**
 * A spot's throw: apex at the light, opening downward, as wide at the far end
 * as the cone angle makes it.
 */
function buildSpotWire(
  radius: number,
  angleDeg: number,
  material: THREE.LineBasicMaterial
): THREE.Object3D {
  const height = radius;
  const spread = Math.tan(angleDeg * THREE.MathUtils.DEG2RAD) * height;
  const cone = new THREE.ConeGeometry(spread, height, RADIAL_SEGMENTS, 1, true);
  // Cone geometry is centred on its own height with the apex up. Slide it so
  // the apex sits at the light and the mouth opens along -Y.
  cone.translate(0, -height / 2, 0);
  return new THREE.LineSegments(new THREE.WireframeGeometry(cone), material);
}

/**
 * An area light's panel, lying flat and facing down.
 *
 * Drawn as a `Line` whose last point repeats its first, rather than a
 * `LineLoop`: the WebGPU renderer does not support loops and refuses to draw
 * one, so closing the rectangle by hand is what puts it on screen.
 */
function buildAreaWire(
  width: number,
  height: number,
  material: THREE.LineBasicMaterial
): THREE.Object3D {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    new THREE.Vector3(-halfWidth, 0, -halfHeight),
    new THREE.Vector3(halfWidth, 0, -halfHeight),
    new THREE.Vector3(halfWidth, 0, halfHeight),
    new THREE.Vector3(-halfWidth, 0, halfHeight)
  ];
  const outline = new THREE.BufferGeometry().setFromPoints([
    ...corners,
    corners[0]!
  ]);
  return new THREE.Line(outline, material);
}

function buildCoverageWire(
  light: PlacedLight,
  material: THREE.LineBasicMaterial
): THREE.Object3D {
  switch (light.kind) {
    case "point":
      return buildPointWire(light.radius ?? 0, material);
    case "spot":
      return buildSpotWire(
        light.radius ?? 0,
        light.spot?.angleDeg ?? 0,
        material
      );
    case "area":
      return buildAreaWire(
        light.area?.width ?? 0,
        light.area?.height ?? 0,
        material
      );
  }
}

/**
 * The renderable Studio draws for one placed light: the coverage wire, plus
 * the dot that makes it selectable.
 */
export function createPlacedLightProxy(light: PlacedLight): THREE.Object3D {
  const color = wireColor(light);
  const proxy = new THREE.Group();
  proxy.name = `placed-light-proxy:${light.instanceId}`;
  proxy.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(CENTRE_MARKER_RADIUS, 12, 8),
      new THREE.MeshBasicMaterial({ color })
    )
  );
  proxy.add(buildCoverageWire(light, new THREE.LineBasicMaterial({ color })));
  return proxy;
}
