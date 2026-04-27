/**
 * Billboard math.
 *
 * Pure cylindrical-billboard helpers shared by tests and the TSL wrapper.
 * The math is intentionally isolated from the rest of render-web so scatter
 * billboards remain a single concern with CPU-verifiable behavior.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface BillboardBasis {
  right: Vec3Like;
  up: Vec3Like;
  forward: Vec3Like;
}

function normalize(x: number, y: number, z: number): Vec3Like {
  const length = Math.hypot(x, y, z);
  if (length <= 0.000001) {
    return { x: 0, y: 0, z: 1 };
  }
  return {
    x: x / length,
    y: y / length,
    z: z / length
  };
}

export function computeBillboardBasis(
  instanceOrigin: Vec3Like,
  cameraPosition: Vec3Like
): BillboardBasis {
  const forward = normalize(
    cameraPosition.x - instanceOrigin.x,
    0,
    cameraPosition.z - instanceOrigin.z
  );
  const right = normalize(forward.z, 0, -forward.x);
  return {
    right,
    up: { x: 0, y: 1, z: 0 },
    forward
  };
}

export function computeBillboardWorldPosition(
  localPosition: Vec3Like,
  instanceOrigin: Vec3Like,
  cameraPosition: Vec3Like
): Vec3Like {
  const basis = computeBillboardBasis(instanceOrigin, cameraPosition);
  return {
    x:
      instanceOrigin.x +
      basis.right.x * localPosition.x +
      basis.up.x * localPosition.y +
      basis.forward.x * localPosition.z,
    y:
      instanceOrigin.y +
      basis.right.y * localPosition.x +
      basis.up.y * localPosition.y +
      basis.forward.y * localPosition.z,
    z:
      instanceOrigin.z +
      basis.right.z * localPosition.x +
      basis.up.z * localPosition.y +
      basis.forward.z * localPosition.z
  };
}
