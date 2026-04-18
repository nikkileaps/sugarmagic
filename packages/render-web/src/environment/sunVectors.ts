/**
 * Canonical authored sun-vector semantics for render-web.
 *
 * Sugarmagic authors sun azimuth/elevation once in EnvironmentDefinition.
 * render-web uses those angles in two different but related ways:
 * - light position direction: vector from the world origin toward the
 *   DirectionalLight's position
 * - incoming light direction: vector pointing from the sun toward the scene,
 *   which is the direction shader graphs should dot against normals
 *
 * Keeping both semantics here prevents the light rig and shader runtime from
 * disagreeing about which hemisphere is illuminated.
 */

import * as THREE from "three";

export function sunPositionDirectionFromAngles(
  azimuthDeg: number,
  elevationDeg: number
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const horizontal = Math.cos(elevation);
  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal
  ).normalize();
}

export function sunIncomingDirectionFromAngles(
  azimuthDeg: number,
  elevationDeg: number
): THREE.Vector3 {
  return sunPositionDirectionFromAngles(azimuthDeg, elevationDeg).multiplyScalar(-1);
}
