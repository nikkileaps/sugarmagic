/**
 * LayoutWorkspace: the Build workspace for authored scene structure
 * and placed region content.
 *
 * Owns: gizmo behavior, origin marker, world cursor, transform
 * interaction sessions, selection-to-gizmo mapping, commit-on-release,
 * tool state and keyboard shortcuts.
 *
 * Does NOT own: runtime scene semantics, canonical documents, shell state.
 */

import * as THREE from "three";
import type { RegionDocument, Scene, SemanticCommand } from "@sugarmagic/domain";
import { resolveSceneObjects, type SceneObject } from "@sugarmagic/runtime-core";
import {
  createInputRouter,
  createHitTestService,
  createToolStateStore,
  createTransformController,
  TOOL_SHORTCUTS,
  type InputRouter,
  type HitTestService,
  type ToolStateStore,
  type TransformValues
} from "../../interaction";
import {
  createLayoutGizmo,
  createOriginMarker,
  createWorldCursor,
  type LayoutGizmo,
  type OriginMarker,
  type WorldCursor
} from "./gizmo";

export interface LayoutWorkspaceConfig {
  onCommand: (command: SemanticCommand) => void;
  onSelect: (entityIds: string[]) => void;
  onPreviewTransform: (instanceId: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void;
  getSelectedId: () => string | null;
  getRegion: () => RegionDocument | null;
  /** Plan 058 — the ambient Scene whose overlay composes onto the
   *  region. Without it the gizmo can't find Scene-scoped
   *  placements/presences and silently hides. */
  getActiveScene: () => Scene | null;
}

export interface LayoutWorkspaceInstance {
  attach: (
    viewportElement: HTMLElement,
    camera: THREE.Camera,
    authoredRoot: THREE.Object3D,
    overlayRoot: THREE.Object3D
  ) => void;
  detach: () => void;
  syncOverlays: () => void;
  /** Per-frame: keep the gizmo a constant size on screen. */
  updateForCamera: () => void;
  /** Release GPU resources; call on final teardown, not on detach. */
  dispose: () => void;
  gizmo: LayoutGizmo;
  originMarker: OriginMarker;
  worldCursor: WorldCursor;
  inputRouter: InputRouter;
  hitTestService: HitTestService;
  toolState: ToolStateStore;
}

export function createLayoutWorkspace(
  config: LayoutWorkspaceConfig
): LayoutWorkspaceInstance {
  const inputRouter = createInputRouter();
  const hitTestService = createHitTestService();
  const toolState = createToolStateStore("move");
  const gizmo = createLayoutGizmo();
  const originMarker = createOriginMarker();
  const worldCursor = createWorldCursor();

  worldCursor.setPosition([0, 0, 0]);

  // Sync gizmo visuals when tool changes
  toolState.subscribe((state) => {
    gizmo.setActiveTool(state.activeTool);
  });

  function getTransform(instanceId: string): TransformValues | null {
    const sceneObject = getSceneObject(instanceId);
    if (!sceneObject) return null;
    return {
      position: sceneObject.transform.position,
      rotation: sceneObject.transform.rotation,
      scale: sceneObject.transform.scale
    };
  }

  function getSceneObject(instanceId: string): SceneObject | null {
    const region = config.getRegion();
    if (!region) return null;
    const objects = resolveSceneObjects(region, {
      activeScene: config.getActiveScene()
    });
    return objects.find((o: SceneObject) => o.instanceId === instanceId) ?? null;
  }

  let transformController: ReturnType<typeof createTransformController> | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let hoverHandler: ((event: PointerEvent) => void) | null = null;
  let attachedOverlayRoot: THREE.Object3D | null = null;
  let attachedElement: HTMLElement | null = null;
  let attachedCamera: THREE.Camera | null = null;

  function buildTransformController(camera: THREE.Camera) {
    return createTransformController({
      hitTestService,
      camera,
      getActiveTool: () => toolState.getState().activeTool,
      getSelectedId: config.getSelectedId,
      getTransform,
      onPreview(instanceId, values) {
        gizmo.setPosition(values.position);
        originMarker.setPosition(values.position);
        config.onPreviewTransform(instanceId, values.position, values.rotation, values.scale);
      },
      onCommit(instanceId, values) {
        const region = config.getRegion();
        if (!region) return;
        const sceneObject = getSceneObject(instanceId);
        if (!sceneObject) return;

        if (sceneObject.kind === "asset") {
          config.onCommand({
            kind: "TransformPlacedAsset",
            target: {
              aggregateKind: "region-document",
              aggregateId: region.identity.id
            },
            subject: { subjectKind: "placed-asset", subjectId: instanceId },
            payload: {
              instanceId,
              position: values.position,
              rotation: values.rotation,
              scale: values.scale
            }
          });
          return;
        }

        if (sceneObject.kind === "player") {
          config.onCommand({
            kind: "TransformPlayerPresence",
            target: {
              aggregateKind: "region-document",
              aggregateId: region.identity.id
            },
            subject: { subjectKind: "player-presence", subjectId: instanceId },
            payload: {
              presenceId: instanceId,
              position: values.position,
              rotation: values.rotation,
              scale: values.scale
            }
          });
          return;
        }

        if (sceneObject.kind === "item") {
          config.onCommand({
            kind: "TransformItemPresence",
            target: {
              aggregateKind: "region-document",
              aggregateId: region.identity.id
            },
            subject: { subjectKind: "item-presence", subjectId: instanceId },
            payload: {
              presenceId: instanceId,
              position: values.position,
              rotation: values.rotation,
              scale: values.scale
            }
          });
          return;
        }

        config.onCommand({
          kind: "TransformNPCPresence",
          target: {
            aggregateKind: "region-document",
            aggregateId: region.identity.id
          },
          subject: { subjectKind: "npc-presence", subjectId: instanceId },
          payload: {
            presenceId: instanceId,
            position: values.position,
            rotation: values.rotation,
            scale: values.scale
          }
        });
      },
      onCancel(instanceId, values) {
        gizmo.setPosition(values.position);
        originMarker.setPosition(values.position);
        config.onPreviewTransform(instanceId, values.position, values.rotation, values.scale);
      },
      onSelect(instanceId) {
        config.onSelect(instanceId ? [instanceId] : []);
      }
    });
  }

  return {
    gizmo,
    originMarker,
    worldCursor,
    inputRouter,
    hitTestService,
    toolState,

    attach(viewportElement, camera, authoredRoot, overlayRoot) {
      hitTestService.setCamera(camera);
      hitTestService.setAuthoredRoot(authoredRoot);
      hitTestService.setOverlayRoot(overlayRoot);
      attachedOverlayRoot = overlayRoot;

      overlayRoot.add(gizmo.root);
      overlayRoot.add(originMarker.root);
      overlayRoot.add(worldCursor.root);

      attachedCamera = camera;
      attachedElement = viewportElement;
      transformController = buildTransformController(camera);
      inputRouter.pushController(transformController);
      inputRouter.attach(viewportElement);

      // Hover affordance: brighten the gizmo handle under the cursor.
      hoverHandler = (event: PointerEvent) => {
        const rect = viewportElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const normalizedY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        const hit = hitTestService.testGizmo(normalizedX, normalizedY);
        gizmo.setHoveredHandle(hit?.objectName ?? null);
      };
      viewportElement.addEventListener("pointermove", hoverHandler);

      // Keyboard shortcuts (G/R/S)
      keydownHandler = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const tool = TOOL_SHORTCUTS[e.key.toLowerCase()];
        if (tool) {
          toolState.setActiveTool(tool);
        }
      };
      window.addEventListener("keydown", keydownHandler);
    },

    detach() {
      inputRouter.detach();
      if (transformController) {
        inputRouter.popController(transformController.id);
        transformController = null;
      }
      if (keydownHandler) {
        window.removeEventListener("keydown", keydownHandler);
        keydownHandler = null;
      }
      if (hoverHandler && attachedElement) {
        attachedElement.removeEventListener("pointermove", hoverHandler);
        hoverHandler = null;
      }
      attachedElement = null;
      attachedCamera = null;
      gizmo.setHoveredHandle(null);
      if (attachedOverlayRoot) {
        attachedOverlayRoot.remove(gizmo.root);
        attachedOverlayRoot.remove(originMarker.root);
        attachedOverlayRoot.remove(worldCursor.root);
        attachedOverlayRoot = null;
      }
      gizmo.setVisible(false);
      originMarker.setVisible(false);
    },

    updateForCamera() {
      if (!attachedCamera || !gizmo.root.visible) return;
      // Constant screen size: world scale proportional to distance.
      // 0.09 puts the ~1.6-unit gizmo around 90-100px at the default
      // FOV; clamped so extreme zooms stay usable.
      const distance = attachedCamera.position.distanceTo(gizmo.root.position);
      gizmo.setScale(Math.min(30, Math.max(0.5, distance * 0.09)));
    },

    dispose() {
      gizmo.dispose();
      originMarker.dispose();
      worldCursor.dispose();
    },

    syncOverlays() {
      const selectedId = config.getSelectedId();
      if (!selectedId) {
        gizmo.setVisible(false);
        originMarker.setVisible(false);
        return;
      }

      const transform = getTransform(selectedId);
      if (!transform) {
        gizmo.setVisible(false);
        originMarker.setVisible(false);
        return;
      }

      gizmo.setPosition(transform.position);
      // Size comes from camera distance (updateForCamera), not the
      // object's scale -- the gizmo reads constant on screen.
      gizmo.setVisible(true);
      originMarker.setPosition(transform.position);
      originMarker.setVisible(true);
    }
  };
}
