/**
 * TransformController: session-based transform interaction for move, rotate, scale.
 *
 * Manages drag sessions with preview → commit/cancel semantics.
 * Gizmo handle names encode both mode and axis: "gizmo-move-x", "gizmo-rotate-z", etc.
 *
 * Manipulation is RAY-BASED (transform-math.ts): the pointer ray is
 * projected onto the dragged axis line (move), the rotation plane
 * (rotate), or the axis distance-from-center (scale). The object
 * tracks the cursor 1:1 at any zoom; degenerate configurations (axis
 * viewed edge-on) freeze the drag instead of flying. Axes are WORLD
 * axes — the gizmo renders world-aligned to match.
 */

import * as THREE from "three";
import type {
  InteractionController,
  NormalizedPointerEvent
} from "./input-router";
import type { HitTestService } from "./hit-test-service";
import type { TransformTool } from "./tool-state";
import {
  angleAroundAxis,
  axisParameterForRay,
  planePointForRay,
  pointerRayFromCamera
} from "./transform-math";

export type TransformAxis = "x" | "y" | "z";
/** Center handles manipulate all axes at once. */
export type DragAxis = TransformAxis | "center";

export interface TransformValues {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

interface DragAnchor {
  /** Object center at drag start (axis/plane origin). */
  center: THREE.Vector3;
  /** Move/scale: axis parameter of the grab point at drag start. */
  axisParameter: number | null;
  /** Rotate: center->pointer vector in the rotation plane at start. */
  planeVector: THREE.Vector3 | null;
  /**
   * Center handles: the camera-facing plane through the object at
   * drag start (normal + grab point on it). Frozen at pointer-down
   * so camera motion mid-drag cannot warp the manipulation.
   */
  cameraPlaneNormal: THREE.Vector3 | null;
  cameraPlanePoint: THREE.Vector3 | null;
}

export interface TransformSession {
  instanceId: string;
  mode: TransformTool;
  axis: DragAxis;
  start: TransformValues;
  current: TransformValues;
  anchor: DragAnchor;
}

export interface TransformControllerConfig {
  hitTestService: HitTestService;
  camera: THREE.Camera;
  getActiveTool: () => TransformTool;
  onPreview: (instanceId: string, values: TransformValues) => void;
  onCommit: (instanceId: string, values: TransformValues) => void;
  onCancel: (instanceId: string, values: TransformValues) => void;
  onSelect: (instanceId: string | null) => void;
  getSelectedId: () => string | null;
  getTransform: (instanceId: string) => TransformValues | null;
}

function parseGizmoHit(name: string): { mode: TransformTool; axis: DragAxis } | null {
  const match = name.match(/^gizmo-(move|rotate|scale)-(x|y|z|center)$/);
  if (!match) return null;
  return { mode: match[1] as TransformTool, axis: match[2] as DragAxis };
}

const AXIS_VECTORS: Record<TransformAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

const MIN_SCALE = 0.01;
/** Grab points closer to center than this can't drive a stable scale ratio. */
const MIN_SCALE_ANCHOR = 0.05;
/**
 * Free-rotate feel: dragging this fraction of the camera distance
 * across the trackball turns the object one radian. Matches the
 * on-screen gizmo size driven by updateForCamera (distance * 0.09).
 */
const TRACKBALL_RADIUS_FACTOR = 0.11;

export function createTransformController(
  config: TransformControllerConfig
): InteractionController {
  let session: TransformSession | null = null;

  function anchorForPointer(
    event: NormalizedPointerEvent,
    mode: TransformTool,
    axis: DragAxis,
    center: THREE.Vector3
  ): DragAnchor {
    const ray = pointerRayFromCamera(
      event.normalizedX,
      event.normalizedY,
      config.camera
    );
    if (axis === "center") {
      // All center handles drag on the camera-facing plane through
      // the object -- the grab point tracks the cursor exactly.
      const normal = new THREE.Vector3();
      config.camera.getWorldDirection(normal);
      const hit = planePointForRay(ray, center, normal);
      return {
        center,
        axisParameter: null,
        planeVector: null,
        cameraPlaneNormal: normal,
        cameraPlanePoint: hit
      };
    }
    if (mode === "rotate") {
      const hit = planePointForRay(ray, center, AXIS_VECTORS[axis]);
      return {
        center,
        axisParameter: null,
        planeVector: hit ? hit.sub(center) : null,
        cameraPlaneNormal: null,
        cameraPlanePoint: null
      };
    }
    return {
      center,
      axisParameter: axisParameterForRay(ray, center, AXIS_VECTORS[axis]),
      planeVector: null,
      cameraPlaneNormal: null,
      cameraPlanePoint: null
    };
  }

  function applyCenterDrag(
    activeSession: TransformSession,
    ray: ReturnType<typeof pointerRayFromCamera>
  ): void {
    const { cameraPlaneNormal, cameraPlanePoint, center } =
      activeSession.anchor;
    if (!cameraPlaneNormal || !cameraPlanePoint) return;
    const hit = planePointForRay(ray, center, cameraPlaneNormal);
    if (!hit) return;

    if (activeSession.mode === "move") {
      const delta = hit.clone().sub(cameraPlanePoint);
      activeSession.current = {
        ...activeSession.current,
        position: [
          activeSession.start.position[0] + delta.x,
          activeSession.start.position[1] + delta.y,
          activeSession.start.position[2] + delta.z
        ]
      };
      return;
    }

    if (activeSession.mode === "scale") {
      const anchorRadius = cameraPlanePoint.distanceTo(center);
      if (anchorRadius < MIN_SCALE_ANCHOR) return;
      const factor = Math.max(
        MIN_SCALE,
        hit.distanceTo(center) / anchorRadius
      );
      activeSession.current = {
        ...activeSession.current,
        scale: [
          Math.max(MIN_SCALE, activeSession.start.scale[0] * factor),
          Math.max(MIN_SCALE, activeSession.start.scale[1] * factor),
          Math.max(MIN_SCALE, activeSession.start.scale[2] * factor)
        ]
      };
      return;
    }

    // Free rotate (trackball): drag direction in the camera plane
    // spins the object around the in-plane axis perpendicular to the
    // drag -- pull down to tip toward you, drag sideways to spin.
    const drag = hit.clone().sub(cameraPlanePoint);
    const dragLength = drag.length();
    if (dragLength < 1e-6) return;
    const rotationAxis = new THREE.Vector3()
      .crossVectors(cameraPlaneNormal, drag)
      .normalize();
    const cameraDistance = ray.origin.distanceTo(center);
    const angle =
      dragLength / Math.max(0.1, cameraDistance * TRACKBALL_RADIUS_FACTOR);
    const startQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...activeSession.start.rotation, "XYZ")
    );
    const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(
      rotationAxis,
      angle
    );
    const nextEuler = new THREE.Euler().setFromQuaternion(
      deltaQuaternion.multiply(startQuaternion),
      "XYZ"
    );
    activeSession.current = {
      ...activeSession.current,
      rotation: [nextEuler.x, nextEuler.y, nextEuler.z]
    };
  }

  return {
    id: "transform-controller",

    onPointerDown(event: NormalizedPointerEvent): boolean {
      if (event.button !== 0) return false;

      const gizmoHit = config.hitTestService.testGizmo(
        event.normalizedX,
        event.normalizedY
      );

      if (gizmoHit) {
        const parsed = parseGizmoHit(gizmoHit.objectName);
        if (parsed) {
          const selectedId = config.getSelectedId();
          if (!selectedId) return false;

          const transform = config.getTransform(selectedId);
          if (!transform) return false;

          session = {
            instanceId: selectedId,
            mode: parsed.mode,
            axis: parsed.axis,
            start: { position: [...transform.position], rotation: [...transform.rotation], scale: [...transform.scale] },
            current: { position: [...transform.position], rotation: [...transform.rotation], scale: [...transform.scale] },
            anchor: anchorForPointer(
              event,
              parsed.mode,
              parsed.axis,
              new THREE.Vector3(...transform.position)
            )
          };
          return true;
        }
      }

      const selectHit = config.hitTestService.testSelect(
        event.normalizedX,
        event.normalizedY
      );
      config.onSelect(selectHit ? selectHit.objectName : null);
      return false;
    },

    onPointerMove(event: NormalizedPointerEvent): void {
      if (!session) return;

      const ray = pointerRayFromCamera(
        event.normalizedX,
        event.normalizedY,
        config.camera
      );

      if (session.axis === "center") {
        applyCenterDrag(session, ray);
        config.onPreview(session.instanceId, session.current);
        return;
      }

      const axisVector = AXIS_VECTORS[session.axis];
      const ai = session.axis === "x" ? 0 : session.axis === "y" ? 1 : 2;

      if (session.mode === "move") {
        if (session.anchor.axisParameter === null) return;
        const parameter = axisParameterForRay(
          ray,
          session.anchor.center,
          axisVector
        );
        if (parameter === null) return;
        const pos: [number, number, number] = [...session.start.position];
        pos[ai] = session.start.position[ai] + (parameter - session.anchor.axisParameter);
        session.current = { ...session.current, position: pos };
      } else if (session.mode === "rotate") {
        if (!session.anchor.planeVector) return;
        const hit = planePointForRay(ray, session.anchor.center, axisVector);
        if (!hit) return;
        const angle = angleAroundAxis(
          session.anchor.planeVector,
          hit.sub(session.anchor.center),
          axisVector
        );
        const rot: [number, number, number] = [...session.start.rotation];
        rot[ai] = session.start.rotation[ai] + angle;
        session.current = { ...session.current, rotation: rot };
      } else if (session.mode === "scale") {
        const anchorParameter = session.anchor.axisParameter;
        if (
          anchorParameter === null ||
          Math.abs(anchorParameter) < MIN_SCALE_ANCHOR
        ) {
          return;
        }
        const parameter = axisParameterForRay(
          ray,
          session.anchor.center,
          axisVector
        );
        if (parameter === null) return;
        // Drag outward from center to grow, inward to shrink -- the
        // ratio of the grab point's distance along the axis.
        const factor = Math.max(MIN_SCALE, parameter / anchorParameter);
        const scl: [number, number, number] = [...session.start.scale];
        scl[ai] = Math.max(MIN_SCALE, session.start.scale[ai] * factor);
        session.current = { ...session.current, scale: scl };
      }

      config.onPreview(session.instanceId, session.current);
    },

    onPointerUp(): void {
      if (!session) return;
      config.onCommit(session.instanceId, session.current);
      session = null;
    },

    onCancel(): void {
      if (!session) return;
      config.onCancel(session.instanceId, session.start);
      session = null;
    }
  };
}
