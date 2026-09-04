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
  applyDelta,
  medianPivot,
  type SelectionDelta,
  type Vector3Tuple
} from "./selection-transform";
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

/** One dragged object and the transform being reported for it. */
export interface DraggedSubject {
  instanceId: string;
  values: TransformValues;
}

/** One object taking part in a drag: where it began and where it is now. */
export interface TransformSubjectSession {
  instanceId: string;
  start: TransformValues;
  current: TransformValues;
}

export interface TransformSession {
  /**
   * Every object the drag moves, in selection order. The drag produces one
   * delta and each subject works out its own result from it, so no object is
   * more the subject of the drag than any other.
   */
  subjects: TransformSubjectSession[];
  mode: TransformTool;
  axis: DragAxis;
  anchor: DragAnchor;
}

/**
 * What a click means for the selection. The object and the intent travel
 * together, so a clear cannot arrive carrying an object and a toggle cannot
 * arrive without one.
 */
export type SelectionIntent =
  | { kind: "replace"; instanceId: string }
  | { kind: "toggle"; instanceId: string }
  | { kind: "clear" };

export interface TransformControllerConfig {
  hitTestService: HitTestService;
  /** Accessor, not a snapshot: the active camera can be swapped
   *  (perspective <-> orthographic top) while the controller lives. */
  getCamera: () => THREE.Camera;
  getActiveTool: () => TransformTool;
  /**
   * The state of every dragged object, reported together. The gizmo sits at
   * the pivot of the whole selection, so a caller that saw one object at a
   * time could not work out where to draw it.
   */
  onPreview: (subjects: readonly DraggedSubject[]) => void;
  /**
   * Every object the drag moved. A drag is one act, so it commits as one
   * command -- otherwise undo steps back through it one object at a time.
   */
  onCommit: (subjects: readonly DraggedSubject[]) => void;
  /** Every dragged object, back at the transform it started the drag with. */
  onCancel: (subjects: readonly DraggedSubject[]) => void;
  onSelect: (intent: SelectionIntent) => void;
  /**
   * Whether a scene object may be selected or dragged (epic #226). The
   * scene composer draws the region's own content so the author can see
   * where things go, but only the Scene's overlay is editable there.
   * Omitted means everything drawn is editable, which is Build.
   */
  isSelectable?: (instanceId: string) => boolean;
  /** Hover affordances (no gesture active): the gizmo handle under
   *  the cursor, or null to clear the brighten. */
  onHoverHandle: (handleName: string | null) => void;
  /** The selectable scene object under the cursor (outline cue),
   *  or null to clear it. */
  onHoverTarget: (object: THREE.Object3D | null) => void;
  /** Everything selected, in selection order. A drag moves all of it. */
  getSelectedIds: () => string[];
  /**
   * Whether the axis scale handles may be dragged. They are unavailable for a
   * selection whose objects point in different directions, because scaling
   * that along one axis about a shared pivot shears, and a
   * position/rotation/scale triple cannot hold a sheared matrix. Omitted means
   * available.
   */
  isAxisScaleAvailable?: () => boolean;
  getTransform: (instanceId: string) => TransformValues | null;
}

const AXIS_VECTORS: Record<TransformAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

/** A drag holds its own copy: the values it starts from must not move under it. */
function copyTransform(values: TransformValues): TransformValues {
  return {
    position: [...values.position],
    rotation: [...values.rotation],
    scale: [...values.scale]
  };
}

const MIN_SCALE = 0.01;
/** Axis-scale grab points closer to the center than this can't drive
 *  a stable ratio (the axis handles sit ~1.3 gizmo units out, so only
 *  degenerate shaft grabs near the origin are affected). */
const MIN_SCALE_ANCHOR = 0.05;

export function createTransformController(
  config: TransformControllerConfig
): InteractionController {
  let session: TransformSession | null = null;

  /** One gate for picking, hovering and dragging: a locked object must
   *  not be selectable by any of them, or "locked" is only cosmetic. */
  const isSelectable = (instanceId: string): boolean =>
    config.isSelectable?.(instanceId) ?? true;

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
      const worldQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
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

  function centerDelta(
    activeSession: TransformSession,
    ray: ReturnType<typeof pointerRayFromCamera>
  ): SelectionDelta | null {
    const { cameraPlaneNormal, cameraPlanePoint, center } =
      activeSession.anchor;
    if (!cameraPlaneNormal || !cameraPlanePoint) return null;
    const hit = planePointForRay(ray, center, cameraPlaneNormal);
    if (!hit) return null;

    if (activeSession.mode === "move") {
      const moved = hit.clone().sub(cameraPlanePoint);
      return { mode: "move", translation: [moved.x, moved.y, moved.z] };
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
      if (!screenDiagonal) return null;
      const gizmoScale = gizmoWorldScaleForCamera(config.getCamera(), center);
      const signedDrag = hit.clone().sub(cameraPlanePoint).dot(screenDiagonal);
      const factor = Math.pow(2, signedDrag / gizmoScale);
      return { mode: "scale", factor: [factor, factor, factor] };
    }

    // Free rotate (trackball): drag direction in the camera plane
    // spins the object around the in-plane axis perpendicular to the
    // drag -- pull down to tip toward you, drag sideways to spin.
    // Operand order matters: drag x forward (NOT forward x drag,
    // which rolled the ball AWAY from the cursor -- caught by the
    // 2026-07-12 branch review; direction is pinned by a test now).
    const drag = hit.clone().sub(cameraPlanePoint);
    const dragLength = drag.length();
    if (dragLength < 1e-6) return null;
    const rotationAxis = new THREE.Vector3()
      .crossVectors(drag, cameraPlaneNormal)
      .normalize();
    const trackballRadius =
      gizmoWorldScaleForCamera(config.getCamera(), center) *
      TRACKBALL_RADIUS_GIZMO_UNITS;
    return {
      mode: "rotate",
      axis: [rotationAxis.x, rotationAxis.y, rotationAxis.z],
      angle: dragLength / trackballRadius
    };
  }

  function axisDelta(
    activeSession: TransformSession,
    ray: ReturnType<typeof pointerRayFromCamera>
  ): SelectionDelta | null {
    const axis = activeSession.axis;
    if (axis === "center") return null;
    const axisVector = AXIS_VECTORS[axis];
    const ai = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const { anchor } = activeSession;

    if (activeSession.mode === "move") {
      if (anchor.axisParameter === null) return null;
      const parameter = axisParameterForRay(ray, anchor.center, axisVector);
      if (parameter === null) return null;
      const translation: Vector3Tuple = [0, 0, 0];
      translation[ai] = parameter - anchor.axisParameter;
      return { mode: "move", translation };
    }

    if (activeSession.mode === "rotate") {
      if (!anchor.planeVector) return null;
      const hit = planePointForRay(ray, anchor.center, axisVector);
      if (!hit) return null;
      return {
        mode: "rotate",
        axis: [axisVector.x, axisVector.y, axisVector.z],
        angle: angleAroundAxis(
          anchor.planeVector,
          hit.sub(anchor.center),
          axisVector
        )
      };
    }

    const anchorParameter = anchor.axisParameter;
    if (
      anchorParameter === null ||
      Math.abs(anchorParameter) < MIN_SCALE_ANCHOR
    ) {
      return null;
    }
    const parameter = axisParameterForRay(ray, anchor.center, axisVector);
    if (parameter === null) return null;
    // Drag outward from center to grow, inward to shrink -- the ratio of the
    // grab point's distance along the axis.
    const factor: Vector3Tuple = [1, 1, 1];
    factor[ai] = Math.max(MIN_SCALE, parameter / anchorParameter);
    return { mode: "scale", factor };
  }

  /** Push the current state of every subject into the live preview. */
  function previewAll(activeSession: TransformSession): void {
    config.onPreview(
      activeSession.subjects.map((subject) => ({
        instanceId: subject.instanceId,
        values: subject.current
      }))
    );
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
          // Greyed handles must also refuse the drag, or "unavailable" is only
          // a colour.
          const axisScaleRefused =
            parsed.mode === "scale" &&
            parsed.axis !== "center" &&
            config.isAxisScaleAvailable?.() === false;
          if (axisScaleRefused) return false;

          // Also here, not only at selection: a locked object must stay
          // undraggable however it came to be selected.
          const subjects = config
            .getSelectedIds()
            .filter(isSelectable)
            .flatMap((instanceId) => {
              const transform = config.getTransform(instanceId);
              return transform
                ? [
                    {
                      instanceId,
                      start: copyTransform(transform),
                      current: copyTransform(transform)
                    }
                  ]
                : [];
            });
          if (subjects.length === 0) return false;

          // The author grabbed the gizmo, so the drag anchors where the gizmo
          // is: the pivot of the whole selection. With one object selected
          // that is its own origin, which is where it anchored before.
          const pivot = medianPivot(
            subjects.map((subject) => subject.start.position)
          );
          if (!pivot) return false;

          session = {
            subjects,
            mode: parsed.mode,
            axis: parsed.axis,
            anchor: anchorForPointer(
              event,
              parsed.mode,
              parsed.axis,
              new THREE.Vector3(...pivot)
            )
          };
          return true;
        }
      }

      const selectHit = config.hitTestService.testSelect(
        event.normalizedX,
        event.normalizedY
      );
      // A locked object is not a miss that falls through to something
      // behind it -- clicking the station selects nothing, which is what
      // "you cannot edit this here" looks like.
      const picked =
        selectHit && isSelectable(selectHit.objectName)
          ? selectHit.objectName
          : null;
      // Shift extends: an object outside the selection joins it, one already
      // in it leaves. A plain click starts over from the object clicked.
      config.onSelect(
        picked === null
          ? { kind: "clear" }
          : { kind: event.shiftKey ? "toggle" : "replace", instanceId: picked }
      );
      return false;
    },

    onPointerMove(event: NormalizedPointerEvent): void {
      if (!session) return;

      const ray = pointerRayFromCamera(
        event.normalizedX,
        event.normalizedY,
        config.getCamera()
      );

      const delta =
        session.axis === "center"
          ? centerDelta(session, ray)
          : axisDelta(session, ray);
      // A degenerate drag -- an axis viewed edge-on, a grab point too close to
      // the centre -- yields no delta, and the selection stays where it is.
      if (!delta) return;

      // The same pivot goes to every object. That is what makes this one
      // shared-pivot mode rather than a rule per object.
      const pivot: Vector3Tuple = [
        session.anchor.center.x,
        session.anchor.center.y,
        session.anchor.center.z
      ];
      for (const subject of session.subjects) {
        subject.current = applyDelta(subject.start, pivot, delta);
      }
      previewAll(session);
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
        selectHit && isSelectable(selectHit.objectName)
          ? selectHit.object
          : null
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
      const moved = session.subjects.filter(
        (subject) =>
          JSON.stringify(subject.current) !== JSON.stringify(subject.start)
      );
      if (moved.length > 0) {
        config.onCommit(
          moved.map((subject) => ({
            instanceId: subject.instanceId,
            values: subject.current
          }))
        );
      }
      session = null;
    },

    onCancel(): void {
      if (!session) return;
      config.onCancel(
        session.subjects.map((subject) => ({
          instanceId: subject.instanceId,
          values: subject.start
        }))
      );
      session = null;
    }
  };
}
