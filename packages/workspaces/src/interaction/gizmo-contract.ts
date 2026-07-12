/**
 * The gizmo contract: single owner of the handle-name grammar, the
 * hit-pick priority rules, and the screen-constant sizing math.
 *
 * Handle names encode meaning as `gizmo-<mode>-<axis>`. The grammar
 * used to live in three unowned copies (constructed in
 * build/layout/gizmo.ts, parsed in transform-controller.ts, matched
 * again in hit-test-service.ts); adding a mode or handle required
 * synchronized edits. Everything derives from here now.
 */

import * as THREE from "three";
import type { TransformTool } from "./tool-state";

export type TransformAxis = "x" | "y" | "z";
/** Center handles manipulate all axes at once. */
export type DragAxis = TransformAxis | "center";

export function gizmoHandleName(mode: TransformTool, axis: DragAxis): string {
  return `gizmo-${mode}-${axis}`;
}

const HANDLE_NAME_PATTERN = /^gizmo-(move|rotate|scale)-(x|y|z|center)$/;

export function parseGizmoHandleName(
  name: string
): { mode: TransformTool; axis: DragAxis } | null {
  const match = name.match(HANDLE_NAME_PATTERN);
  if (!match) return null;
  return { mode: match[1] as TransformTool, axis: match[2] as DragAxis };
}

/**
 * The small move/scale center handles win over axis handles sharing
 * the same ray (a camera looking straight down an axis would otherwise
 * hand the click to an edge-on handle that cannot drag). The rotate
 * trackball is the coarse target and loses to the thin rings, so it
 * is deliberately NOT priority.
 */
export function isCenterPickPriorityHandle(name: string): boolean {
  return name === gizmoHandleName("move", "center") ||
    name === gizmoHandleName("scale", "center");
}

/**
 * Screen-constant gizmo sizing.
 *
 * Perspective: world scale proportional to camera distance. 0.09 puts
 * the ~1.6-unit gizmo around 90-100px at the default 60deg FOV.
 * Orthographic: distance is meaningless (on-screen size is governed
 * by frustum height / zoom), so scale from the visible world height
 * instead; 0.078 = 0.09 / (2 * tan(30deg)) makes the two projections
 * agree at the default FOV.
 *
 * The trackball drag math derives its apparent radius from this same
 * function so rotation sensitivity can never desync from the rendered
 * sphere.
 */
const GIZMO_MIN_WORLD_SCALE = 0.5;
const GIZMO_MAX_WORLD_SCALE = 30;
const GIZMO_DISTANCE_FACTOR = 0.09;
const GIZMO_VISIBLE_HEIGHT_FRACTION = 0.078;

/** Trackball apparent radius, in multiples of the gizmo world scale.
 *  Tuned: one radian per ~1.2 gizmo-scale units of drag. */
export const TRACKBALL_RADIUS_GIZMO_UNITS = 1.2;

export function gizmoWorldScaleForCamera(
  camera: THREE.Camera,
  gizmoPosition: THREE.Vector3
): number {
  let raw: number;
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera;
    const visibleHeight = (ortho.top - ortho.bottom) / ortho.zoom;
    raw = visibleHeight * GIZMO_VISIBLE_HEIGHT_FRACTION;
  } else {
    raw = camera.position.distanceTo(gizmoPosition) * GIZMO_DISTANCE_FACTOR;
  }
  return Math.min(GIZMO_MAX_WORLD_SCALE, Math.max(GIZMO_MIN_WORLD_SCALE, raw));
}
