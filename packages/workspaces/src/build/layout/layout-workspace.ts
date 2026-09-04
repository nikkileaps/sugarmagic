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
import type {
  RegionDocument,
  Scene,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  resolveSceneObjects,
  type SceneObject
} from "@sugarmagic/runtime-core";
import {
  createInputRouter,
  createHitTestService,
  createToolStateStore,
  createTransformController,
  gizmoWorldScaleForCamera,
  TOOL_SHORTCUTS,
  type InputRouter,
  type HitTestService,
  type SelectionIntent,
  type ToolStateStore,
  type TransformValues
} from "../../interaction";
import {
  ACTIVE_HULL_COLOR,
  createLayoutGizmo,
  createObjectHulls,
  createOriginMarker,
  createWorldCursor,
  HOVER_HULL_COLOR,
  SELECTED_HULL_COLOR,
  type HullTarget,
  type LayoutGizmo,
  type OriginMarker,
  type WorldCursor
} from "./gizmo";

export interface LayoutWorkspaceConfig {
  onCommand: (command: SemanticCommand) => void;
  onSelect: (intent: SelectionIntent) => void;
  onPreviewTransform: (
    instanceId: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number]
  ) => void;
  getSelectedId: () => string | null;
  /**
   * The selected object the author touched last. It is outlined more brightly
   * than the rest, and later work reads it for the pivot and axis orientation.
   */
  getActiveId: () => string | null;
  getRegion: () => RegionDocument | null;
  /** Plan 058 — the ambient Scene whose overlay composes onto the
   *  region. Without it the gizmo can't find Scene-scoped
   *  placements/presences and silently hides. */
  getActiveScene: () => Scene | null;
  /**
   * Whether an object may be selected or dragged (epic #226). The scene
   * composer draws the region's own content so the author can see where
   * things sit, and lets them edit only the Scene's overlay. Omitted
   * means everything drawn is editable, which is Build.
   */
  isSelectable?: (instanceId: string) => boolean;
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
  /** Per-frame: keep the gizmo a constant size on screen and track
   *  the host's ACTIVE camera (perspective <-> ortho toggles). */
  updateForCamera: (camera: THREE.Camera) => void;
  /** Release GPU resources; call on final teardown, not on detach. */
  dispose: () => void;
  gizmo: LayoutGizmo;
  originMarker: OriginMarker;
  worldCursor: WorldCursor;
  inputRouter: InputRouter;
  hitTestService: HitTestService;
  toolState: ToolStateStore;
}

/**
 * A marker never shares a selection with anything else. Markers commit through
 * `UpdateRegionMarker` with a patch while every other kind commits through a
 * `Transform*` command, so a mixed selection would have no single shape to
 * commit. Shift-clicking a marker, or shift-clicking anything while a marker is
 * selected, starts a fresh selection instead of extending one.
 *
 * Reading the one selected id is enough to spot a selected marker: because this
 * rule never lets a marker join a larger selection, a selected marker is always
 * the only thing selected.
 */
export function markersStayAlone(
  intent: SelectionIntent,
  selectedId: string | null,
  kindOf: (instanceId: string) => SceneObject["kind"] | null
): SelectionIntent {
  if (intent.kind !== "toggle") return intent;
  const touchesAMarker =
    kindOf(intent.instanceId) === "marker" ||
    (selectedId !== null && kindOf(selectedId) === "marker");
  return touchesAMarker
    ? { kind: "replace", instanceId: intent.instanceId }
    : intent;
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
  const hoverHulls = createObjectHulls("hover-hull");
  const selectionHulls = createObjectHulls("selection-hulls");

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
      activeScene: config.getActiveScene(),
      // The gizmo asks this for the object it is attaching to, so markers
      // have to be in the answer or selecting one finds nothing.
      includeMarkers: true
    });
    return (
      objects.find((o: SceneObject) => o.instanceId === instanceId) ?? null
    );
  }

  let transformController: ReturnType<typeof createTransformController> | null =
    null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let attachedOverlayRoot: THREE.Object3D | null = null;
  let attachedAuthoredRoot: THREE.Object3D | null = null;
  let attachedElement: HTMLElement | null = null;
  let attachedCamera: THREE.Camera | null = null;
  let hoveredObject: THREE.Object3D | null = null;

  /**
   * The drawn object a scene object's id refers to. Scene-object roots are
   * named with their instance id, which is what the hit test resolves a click
   * back to. Null while the object is still loading.
   */
  function getObject(instanceId: string): THREE.Object3D | null {
    return attachedAuthoredRoot?.getObjectByName(instanceId) ?? null;
  }

  /**
   * Decides everything that gets an outline, so hover and selection cannot
   * disagree about an object. An object already outlined as selected is not
   * outlined again as hovered: two shells at the same size would z-fight.
   */
  function syncHulls(): void {
    const selectedTargets: HullTarget[] = [];
    const activeId = config.getActiveId();
    const selectedId = config.getSelectedId();
    for (const instanceId of selectedId ? [selectedId] : []) {
      const object = getObject(instanceId);
      if (!object) continue;
      selectedTargets.push({
        object,
        color: instanceId === activeId ? ACTIVE_HULL_COLOR : SELECTED_HULL_COLOR
      });
    }
    selectionHulls.setTargets(selectedTargets);

    const alreadyOutlined = selectedTargets.some(
      (target) => target.object === hoveredObject
    );
    hoverHulls.setTargets(
      hoveredObject && !alreadyOutlined
        ? [{ object: hoveredObject, color: HOVER_HULL_COLOR }]
        : []
    );
  }

  function buildTransformController(initialCamera: THREE.Camera) {
    return createTransformController({
      hitTestService,
      getCamera: () => attachedCamera ?? initialCamera,
      getActiveTool: () => toolState.getState().activeTool,
      getSelectedId: config.getSelectedId,
      isSelectable: config.isSelectable,
      getTransform,
      onPreview(instanceId, values) {
        gizmo.setPosition(values.position);
        originMarker.setPosition(values.position);
        config.onPreviewTransform(
          instanceId,
          values.position,
          values.rotation,
          values.scale
        );
      },
      onCommit(instanceId, values) {
        const region = config.getRegion();
        if (!region) return;
        const sceneObject = getSceneObject(instanceId);
        if (!sceneObject) return;

        const target = {
          aggregateKind: "region-document" as const,
          aggregateId: region.identity.id
        };
        const { position, rotation, scale } = values;

        // [LAW:types-are-the-program] Exhaustive over the kind, with the
        // `never` check below. This used to end in an unguarded "anything
        // else is an NPC", which silently fired a presence command for a
        // marker: no NPC had that id, nothing changed, and the gizmo
        // snapped back to the authored position with no error anywhere.
        switch (sceneObject.kind) {
          case "asset":
            config.onCommand({
              kind: "TransformPlacedAsset",
              target,
              subject: { subjectKind: "placed-asset", subjectId: instanceId },
              payload: { instanceId, position, rotation, scale }
            });
            return;

          case "player":
            config.onCommand({
              kind: "TransformPlayerPresence",
              target,
              subject: {
                subjectKind: "player-presence",
                subjectId: instanceId
              },
              payload: { presenceId: instanceId, position, rotation, scale }
            });
            return;

          case "item":
            config.onCommand({
              kind: "TransformItemPresence",
              target,
              subject: { subjectKind: "item-presence", subjectId: instanceId },
              payload: { presenceId: instanceId, position, rotation, scale }
            });
            return;

          case "npc":
            config.onCommand({
              kind: "TransformNPCPresence",
              target,
              subject: { subjectKind: "npc-presence", subjectId: instanceId },
              payload: { presenceId: instanceId, position, rotation, scale }
            });
            return;

          case "marker":
            config.onCommand({
              kind: "UpdateRegionMarker",
              target,
              subject: { subjectKind: "region-marker", subjectId: instanceId },
              payload: {
                markerId: instanceId,
                patch: { transform: { position, rotation, scale } }
              }
            });
            return;

          default: {
            const unhandled: never = sceneObject.kind;
            console.warn(
              "[layout-workspace] no transform command for scene object kind",
              unhandled,
              instanceId
            );
          }
        }
      },
      onCancel(instanceId, values) {
        gizmo.setPosition(values.position);
        originMarker.setPosition(values.position);
        config.onPreviewTransform(
          instanceId,
          values.position,
          values.rotation,
          values.scale
        );
      },
      onSelect(intent) {
        config.onSelect(
          markersStayAlone(
            intent,
            config.getSelectedId(),
            (instanceId) => getSceneObject(instanceId)?.kind ?? null
          )
        );
      },
      // Hover affordances arrive through the InputRouter's hover
      // dispatch (top controller only) -- never a raw DOM listener.
      onHoverHandle(handleName) {
        gizmo.setHoveredHandle(handleName);
      },
      onHoverTarget(object) {
        hoveredObject = object;
        syncHulls();
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
      attachedAuthoredRoot = authoredRoot;

      overlayRoot.add(gizmo.root);
      overlayRoot.add(originMarker.root);
      overlayRoot.add(worldCursor.root);
      overlayRoot.add(hoverHulls.root);
      overlayRoot.add(selectionHulls.root);

      attachedCamera = camera;
      attachedElement = viewportElement;
      transformController = buildTransformController(camera);
      inputRouter.pushController(transformController);
      inputRouter.attach(viewportElement);

      // Keyboard shortcuts (G/R/S)
      keydownHandler = (e: KeyboardEvent) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
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
      attachedElement = null;
      attachedCamera = null;
      gizmo.setHoveredHandle(null);
      hoveredObject = null;
      hoverHulls.setTargets([]);
      selectionHulls.setTargets([]);
      attachedAuthoredRoot = null;
      if (attachedOverlayRoot) {
        attachedOverlayRoot.remove(gizmo.root);
        attachedOverlayRoot.remove(originMarker.root);
        attachedOverlayRoot.remove(worldCursor.root);
        attachedOverlayRoot.remove(hoverHulls.root);
        attachedOverlayRoot.remove(selectionHulls.root);
        attachedOverlayRoot = null;
      }
      gizmo.setVisible(false);
      originMarker.setVisible(false);
    },

    updateForCamera(camera) {
      // The host swaps cameras on projection toggle; keep every
      // camera consumer in agreement (rays, picks, gizmo sizing).
      if (attachedElement && camera !== attachedCamera) {
        attachedCamera = camera;
        hitTestService.setCamera(camera);
      }
      hoverHulls.syncTransform();
      selectionHulls.syncTransform();
      if (!attachedCamera || !gizmo.root.visible) return;
      gizmo.setScale(
        gizmoWorldScaleForCamera(attachedCamera, gizmo.root.position)
      );
    },

    dispose() {
      gizmo.dispose();
      originMarker.dispose();
      worldCursor.dispose();
      hoverHulls.dispose();
      selectionHulls.dispose();
    },

    syncOverlays() {
      syncHulls();
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
