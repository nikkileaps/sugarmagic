/**
 * Pure ray math for gizmo manipulation.
 *
 * The transform controller projects the pointer RAY onto the dragged
 * handle's axis or plane, so the object tracks the cursor exactly at
 * any zoom / FOV / camera angle — no pixel-delta sensitivities. Every
 * function returns null in its degenerate configuration (ray nearly
 * parallel to the axis or plane) so callers freeze the drag instead
 * of letting the value fly off.
 */

import * as THREE from "three";

export interface PointerRay {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

/** Below this the axis/plane is too edge-on for a stable solution. */
const DEGENERATE_EPSILON = 0.02;

export function pointerRayFromCamera(
  normalizedX: number,
  normalizedY: number,
  camera: THREE.Camera
): PointerRay {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(normalizedX, normalizedY),
    camera
  );
  return {
    origin: raycaster.ray.origin.clone(),
    direction: raycaster.ray.direction.clone()
  };
}

/**
 * Parameter t of the point on the line `axisOrigin + axisDirection*t`
 * closest to the ray. Null when the ray is nearly parallel to the
 * axis (looking straight down it) — there is no stable answer there.
 */
export function axisParameterForRay(
  ray: PointerRay,
  axisOrigin: THREE.Vector3,
  axisDirection: THREE.Vector3
): number | null {
  const d1 = axisDirection.clone().normalize();
  const d2 = ray.direction.clone().normalize();
  const b = d1.dot(d2);
  const denominator = 1 - b * b;
  if (denominator < DEGENERATE_EPSILON) {
    return null;
  }
  const w = axisOrigin.clone().sub(ray.origin);
  const d = d1.dot(w);
  const e = d2.dot(w);
  // Closest-point-between-lines, with both directions normalized:
  // t = (b*e - d) / (1 - b^2)  (sign convention: w points ray->axis)
  return (b * e - d) / denominator;
}

/**
 * Intersection of the ray with the plane through `planeOrigin` with
 * `planeNormal`. Null when the ray is nearly parallel to the plane or
 * the intersection is behind the ray origin.
 */
export function planePointForRay(
  ray: PointerRay,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3
): THREE.Vector3 | null {
  const normal = planeNormal.clone().normalize();
  const direction = ray.direction.clone().normalize();
  const alignment = direction.dot(normal);
  if (Math.abs(alignment) < DEGENERATE_EPSILON) {
    return null;
  }
  const t = planeOrigin.clone().sub(ray.origin).dot(normal) / alignment;
  if (t < 0) {
    return null;
  }
  return ray.origin.clone().addScaledVector(direction, t);
}

/**
 * Signed angle (radians) rotating `from` onto `to` around `axis`,
 * following the right-hand rule. Inputs need not be normalized.
 */
export function angleAroundAxis(
  from: THREE.Vector3,
  to: THREE.Vector3,
  axis: THREE.Vector3
): number {
  const normal = axis.clone().normalize();
  // Project both vectors into the rotation plane first so any
  // off-plane component can't distort the angle.
  const projectedFrom = from
    .clone()
    .sub(normal.clone().multiplyScalar(from.dot(normal)));
  const projectedTo = to
    .clone()
    .sub(normal.clone().multiplyScalar(to.dot(normal)));
  const cross = projectedFrom.clone().cross(projectedTo);
  return Math.atan2(cross.dot(normal), projectedFrom.dot(projectedTo));
}
