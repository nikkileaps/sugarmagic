export {
  createInputRouter,
  type InputRouter,
  type InteractionController,
  type NormalizedPointerEvent
} from "./input-router";

export {
  createHitTestService,
  SCENE_OBJECT_MARKER_KEY,
  buildSceneObjectMarker,
  resolveSceneObjectMarker,
  type HitTestService,
  type HitTestResult,
  type HitTestMode,
  type SceneObjectMarker
} from "./hit-test-service";

export {
  gizmoHandleName,
  parseGizmoHandleName,
  isCenterPickPriorityHandle,
  gizmoWorldScaleForCamera,
  TRACKBALL_RADIUS_GIZMO_UNITS,
  type DragAxis
} from "./gizmo-contract";

export {
  createToolStateStore,
  TOOL_SHORTCUTS,
  type ToolStateStore,
  type ToolState,
  type TransformTool
} from "./tool-state";

export {
  applyDelta,
  hasMixedRotations,
  medianPivot,
  type SelectionDelta,
  type Vector3Tuple
} from "./selection-transform";

export {
  createTransformController,
  type DraggedSubject,
  type SelectionIntent,
  type TransformControllerConfig,
  type TransformSession,
  type TransformSubjectSession,
  type TransformAxis,
  type TransformValues
} from "./transform-controller";
export {
  angleAroundAxis,
  axisParameterForRay,
  planePointForRay,
  pointerRayFromCamera,
  type PointerRay
} from "./transform-math";
