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
import type { RegionDocument, SemanticCommand } from "@sugarmagic/domain";
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
    const region = config.getRegion();
    if (!region) return null;
    const objects = resolveSceneObjects(region);
    const obj = objects.find((o: SceneObject) => o.instanceId === instanceId);
    if (!obj) return null;
    return {
      position: obj.transform.position,
      rotation: obj.transform.rotation,
      scale: obj.transform.scale
    };
  }

  let transformController: ReturnType<typeof createTransformController> | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let attachedOverlayRoot: THREE.Object3D | null = null;

  function buildTransformController(camera: THREE.Camera) {
    return createTransformController({
      hitTestService,
      camera,
      getActiveTool: () => toolState.getState().activeTool,
      getSelectedId: config.getSelectedId,
      getTransform,
      onPreview(instanceId, values) {
        gizmo.setPosition(values.position);
        gizmo.setRotation(values.rotation);
        originMarker.setPosition(values.position);
        config.onPreviewTransform(instanceId, values.position, values.rotation, values.scale);
      },
      onCommit(instanceId, values) {
        const region = config.getRegion();
        if (!region) return;

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
      },
      onCancel(instanceId, values) {
        gizmo.setPosition(values.position);
        gizmo.setRotation(values.rotation);
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

      transformController = buildTransformController(camera);
      inputRouter.pushController(transformController);
      inputRouter.attach(viewportElement);

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
      if (attachedOverlayRoot) {
        attachedOverlayRoot.remove(gizmo.root);
        attachedOverlayRoot.remove(originMarker.root);
        attachedOverlayRoot.remove(worldCursor.root);
        attachedOverlayRoot = null;
      }
      gizmo.setVisible(false);
      originMarker.setVisible(false);
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
      gizmo.setRotation(transform.rotation);
      const largestAxisScale = Math.max(
        transform.scale[0],
        transform.scale[1],
        transform.scale[2]
      );
      gizmo.setScale(Math.min(2.4, Math.max(1.4, largestAxisScale * 1.1)));
      gizmo.setVisible(true);
      originMarker.setPosition(transform.position);
      originMarker.setVisible(true);
    }
  };
}
