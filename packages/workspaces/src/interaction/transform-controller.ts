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
import {
  gizmoWorldScaleForCamera,
  parseGizmoHandleName,
  TRACKBALL_RADIUS_GIZMO_UNITS,
  type DragAxis,
  type TransformAxis
} from "./gizmo-contract";

export type { DragAxis, TransformAxis } from "./gizmo-contract";

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
  /** Center scale: the screen up-right diagonal in world space,
   *  frozen at drag start (signed drag axis for uniform scale). */
  screenDiagonal: THREE.Vector3 | null;
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
  /** Accessor, not a snapshot: the active camera can be swapped
   *  (perspective <-> orthographic top) while the controller lives. */
  getCamera: () => THREE.Camera;
  getActiveTool: () => TransformTool;
  onPreview: (instanceId: string, values: TransformValues) => void;
  onCommit: (instanceId: string, values: TransformValues) => void;
  onCancel: (instanceId: string, values: TransformValues) => void;
  onSelect: (instanceId: string | null) => void;
  /** Hover affordances (no gesture active): the gizmo handle under
   *  the cursor, or null to clear the brighten. */
  onHoverHandle: (handleName: string | null) => void;
  /** The selectable scene object under the cursor (outline cue),
   *  or null to clear it. */
  onHoverTarget: (object: THREE.Object3D | null) => void;
  getSelectedId: () => string | null;
  getTransform: (instanceId: string) => TransformValues | null;
}

const AXIS_VECTORS: Record<TransformAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

const MIN_SCALE = 0.01;
/** Axis-scale grab points closer to the center than this can't drive
 *  a stable ratio (the axis handles sit ~1.3 gizmo units out, so only
 *  degenerate shaft grabs near the origin are affected). */
const MIN_SCALE_ANCHOR = 0.05;

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
    const camera = config.getCamera();
    const ray = pointerRayFromCamera(
      event.normalizedX,
      event.normalizedY,
      camera
    );
    if (axis === "center") {
      // All center handles drag on the camera-facing plane through
      // the object -- the grab point tracks the cursor exactly.
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      const hit = planePointForRay(ray, center, normal);
      const worldQuaternion = camera.getWorldQuaternion(
        new THREE.Quaternion()
      );
      const screenDiagonal = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(worldQuaternion)
        .add(new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuaternion))
        .normalize();
      return {
        center,
        axisParameter: null,
        planeVector: null,
        cameraPlaneNormal: normal,
        cameraPlanePoint: hit,
        screenDiagonal
      };
    }
    if (mode === "rotate") {
      const hit = planePointForRay(ray, center, AXIS_VECTORS[axis]);
      return {
        center,
        axisParameter: null,
        planeVector: hit ? hit.sub(center) : null,
        cameraPlaneNormal: null,
        cameraPlanePoint: null,
        screenDiagonal: null
      };
    }
    return {
      center,
      axisParameter: axisParameterForRay(ray, center, AXIS_VECTORS[axis]),
      planeVector: null,
      cameraPlaneNormal: null,
      cameraPlanePoint: null,
      screenDiagonal: null
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
      // SIGNED drag along the screen's up-right diagonal (the Unity
      // center-cube mapping): up/right grows, down/left shrinks,
      // unbounded both ways. Distance-from-center mappings both
      // failed here: a grab-point ratio has a near-zero denominator
      // (pixels of drag exploded the scale), and an unsigned radial
      // delta bounces at the center -- the cursor crosses it after a
      // few pixels of shrink and the object grows again. Exponential
      // so one gizmo-width of drag doubles or halves symmetrically.
      const { screenDiagonal } = activeSession.anchor;
      if (!screenDiagonal) return;
      const gizmoScale = gizmoWorldScaleForCamera(config.getCamera(), center);
      const signedDrag = hit.clone().sub(cameraPlanePoint).dot(screenDiagonal);
      const factor = Math.pow(2, signedDrag / gizmoScale);
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
    // Operand order matters: drag x forward (NOT forward x drag,
    // which rolled the ball AWAY from the cursor -- caught by the
    // 2026-07-12 branch review; direction is pinned by a test now).
    const drag = hit.clone().sub(cameraPlanePoint);
    const dragLength = drag.length();
    if (dragLength < 1e-6) return;
    const rotationAxis = new THREE.Vector3()
      .crossVectors(drag, cameraPlaneNormal)
      .normalize();
    const trackballRadius =
      gizmoWorldScaleForCamera(config.getCamera(), center) *
      TRACKBALL_RADIUS_GIZMO_UNITS;
    const angle = dragLength / trackballRadius;
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
        const parsed = parseGizmoHandleName(gizmoHit.objectName);
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
        config.getCamera()
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

    onHoverMove(event: NormalizedPointerEvent): void {
      // A held button without an accepted gesture (camera orbit)
      // must not churn hover affordances mid-motion.
      if (event.buttons !== 0) return;
      const gizmoHit = config.hitTestService.testGizmo(
        event.normalizedX,
        event.normalizedY
      );
      config.onHoverHandle(gizmoHit?.objectName ?? null);
      if (gizmoHit) {
        config.onHoverTarget(null);
        return;
      }
      const selectHit = config.hitTestService.testSelect(
        event.normalizedX,
        event.normalizedY
      );
      config.onHoverTarget(
        selectHit && selectHit.objectName ? selectHit.object : null
      );
    },

    onHoverLeave(): void {
      config.onHoverHandle(null);
      config.onHoverTarget(null);
    },

    onPointerUp(): void {
      if (!session) return;
      // Frozen/degenerate drags end with current === start; committing
      // those would push no-op transform commands into undo history.
      const moved =
        JSON.stringify(session.current) !== JSON.stringify(session.start);
      if (moved) {
        config.onCommit(session.instanceId, session.current);
      }
      session = null;
    },

    onCancel(): void {
      if (!session) return;
      config.onCancel(session.instanceId, session.start);
      session = null;
    }
  };
}
