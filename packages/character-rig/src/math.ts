/**
 * packages/character-rig/src/math.ts
 *
 * Purpose: Plan 062 §062.2 — minimal vector/quaternion helpers so
 * the rig core stays THREE-free (worker-safe, dependency-free).
 * Plain number-triple/quad arrays matching the domain rig
 * contract's storage shape.
 *
 * Status: active
 */

export type Vec3 = readonly [number, number, number];
/** Quaternion [x, y, z, w] — glTF component order. */
export type Quat = readonly [number, number, number, number];

export const VEC3_ZERO: Vec3 = [0, 0, 0];
export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

export function vec3Length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

export function quatConjugate(a: Quat): Quat {
  return [-a[0], -a[1], -a[2], a[3]];
}

/** Shortest-arc rotation taking unit vector a onto unit vector b. */
export function quatFromUnitVectors(a: Vec3, b: Vec3): Quat {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot > 0.999999) return QUAT_IDENTITY;
  if (dot < -0.999999) {
    // Antiparallel: rotate 180 degrees around any perpendicular.
    const axis: Vec3 =
      Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perp: Vec3 = [
      a[1] * axis[2] - a[2] * axis[1],
      a[2] * axis[0] - a[0] * axis[2],
      a[0] * axis[1] - a[1] * axis[0]
    ];
    const length = Math.hypot(perp[0], perp[1], perp[2]) || 1;
    return [perp[0] / length, perp[1] / length, perp[2] / length, 0];
  }
  const cross: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const w = 1 + dot;
  const length = Math.hypot(cross[0], cross[1], cross[2], w);
  return [cross[0] / length, cross[1] / length, cross[2] / length, w / length];
}

/** Rotate a vector by a quaternion. */
export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx)
  ];
}
