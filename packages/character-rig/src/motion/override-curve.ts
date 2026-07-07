/**
 * packages/character-rig/src/motion/override-curve.ts
 *
 * Purpose: Plan 063 §063.6 — user-editable semantic curve
 * overrides: a PERIODIC smooth curve through draggable control
 * points (Catmull-Rom with wrap-around, so the loop closes by
 * construction like everything else in the motion system). An
 * override REPLACES a channel's generated signal; it lives in the
 * recipe (`curveOverrides`) as plain point data.
 *
 * Hand-rolled rather than bezier-js (plan note updated): the
 * periodic wrap is the whole requirement and is ~20 lines;
 * bezier-js solves open cubic segments.
 *
 * Status: active
 */

export interface CurvePoint {
  /** Loop phase, 0..1. */
  x: number;
  /** Signal value at that phase. */
  y: number;
}

/**
 * Evaluate a periodic Catmull-Rom curve through `points` at
 * `phase` [0,1). Points are treated as sorted by x and wrapping
 * (the segment from the last point back to the first crosses the
 * loop seam). Fewer than 2 points degenerate to a constant.
 */
export function evaluateOverrideCurve(
  points: readonly CurvePoint[],
  phase: number
): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0]!.y;
  const wrapped = phase - Math.floor(phase);
  const count = points.length;

  // Find the segment [i, i+1] containing `wrapped` (wrap-aware).
  let segment = count - 1; // default: seam segment last -> first
  for (let i = 0; i < count - 1; i += 1) {
    if (wrapped >= points[i]!.x && wrapped < points[i + 1]!.x) {
      segment = i;
      break;
    }
  }
  const p1 = points[segment]!;
  const p2 = points[(segment + 1) % count]!;
  const p0 = points[(segment - 1 + count) % count]!;
  const p3 = points[(segment + 2) % count]!;

  // Segment-local t with wrap-aware span.
  const span = segment === count - 1 ? 1 - p1.x + p2.x : p2.x - p1.x;
  if (span <= 1e-9) return p1.y;
  const local =
    segment === count - 1
      ? (wrapped >= p1.x ? wrapped - p1.x : wrapped + 1 - p1.x) / span
      : (wrapped - p1.x) / span;
  const t = Math.max(0, Math.min(1, local));

  // Catmull-Rom (uniform) on y.
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  );
}

/** Normalize user points: clamp x to [0,1), sort, dedupe near-x. */
export function normalizeOverridePoints(
  points: readonly CurvePoint[]
): CurvePoint[] {
  const cleaned = points
    .map((point) => ({
      x: Math.max(0, Math.min(0.999, point.x)),
      y: point.y
    }))
    .sort((a, b) => a.x - b.x);
  const result: CurvePoint[] = [];
  for (const point of cleaned) {
    const previous = result[result.length - 1];
    if (previous && point.x - previous.x < 0.01) continue;
    result.push(point);
  }
  return result;
}
