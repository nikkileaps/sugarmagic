/**
 * TransformController: session-based transform interaction for move, rotate, scale.
 *
 * Manages drag sessions with preview → commit/cancel semantics.
 * Gizmo handle names encode both mode and axis: "gizmo-move-x", "gizmo-rotate-z", etc.
 */

import * as THREE from "three";
import type {
  InteractionController,
  NormalizedPointerEvent
} from "./input-router";
import type { HitTestService } from "./hit-test-service";
import type { TransformTool } from "./tool-state";

export type TransformAxis = "x" | "y" | "z";

export interface TransformValues {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface TransformSession {
  instanceId: string;
  mode: TransformTool;
  axis: TransformAxis;
  start: TransformValues;
  current: TransformValues;
  dragOriginScreen: { x: number; y: number };
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

function parseGizmoHit(name: string): { mode: TransformTool; axis: TransformAxis } | null {
  const match = name.match(/^gizmo-(move|rotate|scale)-(x|y|z)$/);
  if (!match) return null;
  return { mode: match[1] as TransformTool, axis: match[2] as TransformAxis };
}

const AXIS_VECTORS: Record<TransformAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

const MOVE_SENSITIVITY = 0.02;
const ROTATE_SENSITIVITY = 0.01;
const SCALE_SENSITIVITY = 0.005;

export function createTransformController(
  config: TransformControllerConfig
): InteractionController {
  let session: TransformSession | null = null;

  function projectAxisDelta(axis: TransformAxis, dx: number, dy: number): number {
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    camRight.setFromMatrixColumn(config.camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(config.camera.matrixWorld, 1);

    const axisVec = AXIS_VECTORS[axis];
    return dx * axisVec.dot(camRight) + dy * axisVec.dot(camUp);
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
            dragOriginScreen: { x: event.screenX, y: event.screenY }
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

      const dx = event.screenX - session.dragOriginScreen.x;
      const dy = -(event.screenY - session.dragOriginScreen.y);
      const rawDelta = projectAxisDelta(session.axis, dx, dy);
      const ai = session.axis === "x" ? 0 : session.axis === "y" ? 1 : 2;

      if (session.mode === "move") {
        const pos: [number, number, number] = [...session.start.position];
        pos[ai] += rawDelta * MOVE_SENSITIVITY;
        session.current = { ...session.current, position: pos };
      } else if (session.mode === "rotate") {
        const rot: [number, number, number] = [...session.start.rotation];
        rot[ai] += rawDelta * ROTATE_SENSITIVITY;
        session.current = { ...session.current, rotation: rot };
      } else if (session.mode === "scale") {
        const scl: [number, number, number] = [...session.start.scale];
        scl[ai] = session.start.scale[ai] * Math.max(0.01, 1 + rawDelta * SCALE_SENSITIVITY);
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
