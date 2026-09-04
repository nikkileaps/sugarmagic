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

/** Every light proxy is this one colour, the way a collider wireframe is
 *  always blue. Amber reads against grass, dirt and stone alike. */
export const PLACED_LIGHT_WIRE_COLOR = 0xffa726;

/** The grabbable dot at the light's position. A wire is nearly impossible to
 *  click; this is what the raycast hits, as in Blender. */
const CENTRE_MARKER_RADIUS = 0.15;

/** Enough segments to read as round without drawing a net. */
const RADIAL_SEGMENTS = 16;

function wireMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color: PLACED_LIGHT_WIRE_COLOR });
}

/** A point light reaches the same distance in every direction. */
function buildPointWire(radius: number): THREE.Object3D {
  return new THREE.LineSegments(
    new THREE.WireframeGeometry(
      new THREE.SphereGeometry(radius, RADIAL_SEGMENTS, 8)
    ),
    wireMaterial()
  );
}

/**
 * A spot's throw: apex at the light, opening downward, as wide at the far end
 * as the cone angle makes it.
 */
function buildSpotWire(radius: number, angleDeg: number): THREE.Object3D {
  const height = radius;
  const spread = Math.tan(angleDeg * THREE.MathUtils.DEG2RAD) * height;
  const cone = new THREE.ConeGeometry(spread, height, RADIAL_SEGMENTS, 1, true);
  // Cone geometry is centred on its own height with the apex up. Slide it so
  // the apex sits at the light and the mouth opens along -Y.
  cone.translate(0, -height / 2, 0);
  return new THREE.LineSegments(
    new THREE.WireframeGeometry(cone),
    wireMaterial()
  );
}

/** An area light's panel, lying flat and facing down. */
function buildAreaWire(width: number, height: number): THREE.Object3D {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const outline = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-halfWidth, 0, -halfHeight),
    new THREE.Vector3(halfWidth, 0, -halfHeight),
    new THREE.Vector3(halfWidth, 0, halfHeight),
    new THREE.Vector3(-halfWidth, 0, halfHeight)
  ]);
  return new THREE.LineLoop(outline, wireMaterial());
}

function buildCoverageWire(light: PlacedLight): THREE.Object3D {
  switch (light.kind) {
    case "point":
      return buildPointWire(light.radius ?? 0);
    case "spot":
      return buildSpotWire(light.radius ?? 0, light.spot?.angleDeg ?? 0);
    case "area":
      return buildAreaWire(light.area?.width ?? 0, light.area?.height ?? 0);
  }
}

/**
 * The renderable Studio draws for one placed light: the coverage wire, plus
 * the dot that makes it selectable.
 */
export function createPlacedLightProxy(light: PlacedLight): THREE.Object3D {
  const proxy = new THREE.Group();
  proxy.name = `placed-light-proxy:${light.instanceId}`;
  proxy.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(CENTRE_MARKER_RADIUS, 12, 8),
      new THREE.MeshBasicMaterial({ color: PLACED_LIGHT_WIRE_COLOR })
    )
  );
  proxy.add(buildCoverageWire(light));
  return proxy;
}
