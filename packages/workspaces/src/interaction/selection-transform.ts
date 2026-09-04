/**
 * Where a gizmo sits for a selection, and how a drag applies to each object in
 * it. Pure geometry: transforms in, transforms out, no scene graph and no
 * store.
 */

import * as THREE from "three";
import type { TransformValues } from "./transform-controller";

export type Vector3Tuple = [number, number, number];

/** Scales below this collapse an object to nothing and cannot be undone by dragging back. */
export const MIN_SCALE = 0.01;

/**
 * Where the gizmo sits for a selection: the mean of the selected objects'
 * origins, which is Blender's default and what it calls Median Point -- "the
 * averaged-out position of the origins of the selected objects. The shape and
 * size of the objects is not taken into account."
 *
 * Being a mean it is density-weighted: five objects clustered on the left and
 * one far to the right puts the gizmo near the cluster, not halfway between.
 * With one object it is that object's own origin, so a single selection behaves
 * exactly as it did before selections could hold more than one.
 *
 * Null when nothing is selected -- there is no pivot, which is different from a
 * pivot at the world origin.
 */
export function medianPivot(
  origins: readonly Vector3Tuple[]
): Vector3Tuple | null {
  if (origins.length === 0) return null;
  const sum = origins.reduce<Vector3Tuple>(
    (total, origin) => [
      total[0] + origin[0],
      total[1] + origin[1],
      total[2] + origin[2]
    ],
    [0, 0, 0]
  );
  return [
    sum[0] / origins.length,
    sum[1] / origins.length,
    sum[2] / origins.length
  ];
}

/**
 * What one drag did, stated once for the whole selection rather than per
 * object. Each object then works out its own result from it, which is what
 * lets a drag cover many objects without the maths running many times.
 */
export type SelectionDelta =
  | { mode: "move"; translation: Vector3Tuple }
  | { mode: "rotate"; axis: Vector3Tuple; angle: number }
  | { mode: "scale"; factor: Vector3Tuple };

/**
 * Where one object ends up when a drag is applied to it about a pivot.
 *
 * Called once per selected object with the same pivot each time. Blender's
 * Individual Origins mode passes each object its own origin instead, which is
 * why the pivot is a parameter rather than something worked out in here -- the
 * other pivot modes are then a different argument, not different code.
 *
 * Move is pivot-independent: a translation is the same vector wherever the
 * gizmo sits. Rotate and scale change the object twice over, moving its origin
 * relative to the pivot AND turning or resizing the object itself.
 */
export function applyDelta(
  start: TransformValues,
  pivot: Vector3Tuple,
  delta: SelectionDelta
): TransformValues {
  if (delta.mode === "move") {
    return {
      ...start,
      position: [
        start.position[0] + delta.translation[0],
        start.position[1] + delta.translation[1],
        start.position[2] + delta.translation[2]
      ]
    };
  }

  const offset = new THREE.Vector3(
    start.position[0] - pivot[0],
    start.position[1] - pivot[1],
    start.position[2] - pivot[2]
  );

  if (delta.mode === "scale") {
    return {
      ...start,
      position: [
        pivot[0] + offset.x * delta.factor[0],
        pivot[1] + offset.y * delta.factor[1],
        pivot[2] + offset.z * delta.factor[2]
      ],
      scale: [
        Math.max(MIN_SCALE, start.scale[0] * delta.factor[0]),
        Math.max(MIN_SCALE, start.scale[1] * delta.factor[1]),
        Math.max(MIN_SCALE, start.scale[2] * delta.factor[2])
      ]
    };
  }

  const turn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...delta.axis).normalize(),
    delta.angle
  );
  const orbited = offset.clone().applyQuaternion(turn);
  // Composed as quaternions rather than added component by component: adding
  // to one Euler component is only the same turn when the other two are zero.
  const turned = new THREE.Euler().setFromQuaternion(
    turn
      .clone()
      .multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...start.rotation, "XYZ")
        )
      ),
    "XYZ"
  );
  return {
    ...start,
    position: [
      pivot[0] + orbited.x,
      pivot[1] + orbited.y,
      pivot[2] + orbited.z
    ],
    rotation: [turned.x, turned.y, turned.z]
  };
}

/**
 * Whether scaling this selection along one axis would shear it.
 *
 * `applyDelta` spreads the objects' origins along WORLD axes while multiplying
 * each object's own scale, which is read along its LOCAL axes. Those two agree
 * only where an object is unrotated. Where they disagree the arrangement
 * stretches one way and the geometry stretches another, which is shear -- and
 * a position/rotation/scale triple has no way to hold a sheared matrix. The
 * Blender manual puts it plainly: shear "can't be represented by location,
 * scale and rotation".
 *
 * So the question is not whether the objects agree with each other -- two props
 * both turned 45 degrees shear exactly as badly as one turned and one not --
 * but whether any of them is turned at all.
 *
 * One object is always safe: the pivot is its own origin, so there is no spread
 * to disagree with, and scaling its local axes is what a single-object axis
 * drag has always done.
 */
export function axisScaleWouldShear(
  rotations: readonly Vector3Tuple[]
): boolean {
  if (rotations.length < 2) return false;
  return rotations.some((rotation) => {
    const turn = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...rotation, "XYZ")
    );
    // The identity quaternion is (0, 0, 0, +-1), so |w| is 1 exactly when the
    // object is unrotated, whichever way round the quaternion was written.
    return Math.abs(turn.w) < 1 - 1e-6;
  });
}
