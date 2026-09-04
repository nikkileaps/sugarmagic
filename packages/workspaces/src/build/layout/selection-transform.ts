/**
 * Where a gizmo sits for a selection, and how a drag applies to each object in
 * it. Pure geometry: no scene graph, no store, no three.js objects.
 */

export type Vector3Tuple = [number, number, number];

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
