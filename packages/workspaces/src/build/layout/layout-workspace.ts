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
  SemanticCommand,
  TransformSubject
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
  axisScaleWouldShear,
  medianPivot,
  type DraggedSubject,
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
  /**
   * Forget the drafts for these objects. A draft outranks the authored
   * transform wherever it is drawn, so one left behind after a drag pins the
   * object to where that drag ended and later undo appears to do nothing.
   */
  onClearPreviewTransforms: (instanceIds: string[]) => void;
  /** Everything selected, in selection order. */
  getSelectedIds: () => string[];
  /**
   * The selected object the author touched last. It is outlined more brightly
   * than the rest, and later work reads it for the axis orientation.
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
 * How a scene object of this kind records a new transform. Five kinds carry
 * the transform itself; a marker carries a patch instead, which is why it
 * cannot ride along in a batch with the others.
 *
 * `names` says which id the command's payload carries, so the caller reads it
 * off the answer instead of comparing against a command name. Pairing
 * `names: "instance"` with a presence command does not typecheck, so the two
 * halves cannot drift apart.
 *
 * The switch is exhaustive and the `never` below holds it that way: a kind
 * with no answer here stops the build rather than falling through to whichever
 * command happens to be last.
 */
export type TransformCommit =
  | {
      via: "transform";
      names: "instance";
      commandKind: "TransformPlacedAsset" | "TransformPlacedLight";
      subjectKind: TransformSubject["subjectKind"];
    }
  | {
      via: "transform";
      names: "presence";
      commandKind:
        | "TransformPlayerPresence"
        | "TransformNPCPresence"
        | "TransformItemPresence";
      subjectKind: TransformSubject["subjectKind"];
    }
  | { via: "marker-patch" };

export function transformCommitFor(kind: SceneObject["kind"]): TransformCommit {
  switch (kind) {
    case "asset":
      return {
        via: "transform",
        names: "instance",
        commandKind: "TransformPlacedAsset",
        subjectKind: "placed-asset"
      };
    case "light":
      return {
        via: "transform",
        names: "instance",
        commandKind: "TransformPlacedLight",
        subjectKind: "placed-light"
      };
    case "player":
      return {
        via: "transform",
        names: "presence",
        commandKind: "TransformPlayerPresence",
        subjectKind: "player-presence"
      };
    case "npc":
      return {
        via: "transform",
        names: "presence",
        commandKind: "TransformNPCPresence",
        subjectKind: "npc-presence"
      };
    case "item":
      return {
        via: "transform",
        names: "presence",
        commandKind: "TransformItemPresence",
        subjectKind: "item-presence"
      };
    case "marker":
      return { via: "marker-patch" };
    default: {
      const unhandled: never = kind;
      throw new Error(
        `[layout-workspace] no transform command for scene object kind ${unhandled}; give it a case in transformCommitFor before it can be moved.`
      );
    }
  }
}

/**
 * The command that records a new transform for one object -- an inspector
 * field edited, or snap-to-origin from the context menu. A gizmo drag covers a
 * whole selection and batches instead, but both go through
 * `transformCommitFor` so a kind cannot commit two different ways.
 *
 * A placed asset and a placed light name the object `instanceId` while the
 * three presences name it `presenceId`; that is the only difference left
 * between them, and `commit.names` is what says which.
 */
/** Why the gizmo withholds per-axis scale. */
export type AxisScaleBlock = "light-has-no-size" | "rotated-selection";

/**
 * What stops this selection from scaling along one axis, or null when nothing
 * does.
 *
 * A light has no size to scale -- an area light's size is two of its own
 * fields, not the object's scale -- and rotated objects would shear. One
 * reading answers both the greyed handles and the sentence explaining them, so
 * what is shown and what is said cannot disagree.
 */
export function axisScaleBlockedBy(
  objects: readonly SceneObject[]
): AxisScaleBlock | null {
  if (objects.some((object) => object.kind === "light")) {
    return "light-has-no-size";
  }
  if (axisScaleWouldShear(objects.map((object) => object.transform.rotation))) {
    return "rotated-selection";
  }
  return null;
}

export function singleTransformCommand(
  kind: SceneObject["kind"],
  regionId: string,
  instanceId: string,
  values: TransformValues
): SemanticCommand {
  const target = {
    aggregateKind: "region-document" as const,
    aggregateId: regionId
  };
  const { position, rotation, scale } = values;
  const commit = transformCommitFor(kind);

  if (commit.via === "marker-patch") {
    return {
      kind: "UpdateRegionMarker",
      target,
      subject: { subjectKind: "region-marker", subjectId: instanceId },
      payload: {
        markerId: instanceId,
        patch: { transform: { position, rotation, scale } }
      }
    };
  }

  const subject = { subjectKind: commit.subjectKind, subjectId: instanceId };
  return commit.names === "instance"
    ? {
        kind: commit.commandKind,
        target,
        subject,
        payload: { instanceId, position, rotation, scale }
      }
    : {
        kind: commit.commandKind,
        target,
        subject,
        payload: { presenceId: instanceId, position, rotation, scale }
      };
}

/**
 * A marker never shares a selection with anything else. Markers commit through
 * `UpdateRegionMarker` with a patch while every other kind commits through a
 * `Transform*` command, so a mixed selection would have no single shape to
 * commit. Shift-clicking a marker, or shift-clicking anything while a marker is
 * selected, starts a fresh selection instead of extending one.
 */
export function markersStayAlone(
  intent: SelectionIntent,
  selectedIds: readonly string[],
  kindOf: (instanceId: string) => SceneObject["kind"] | null
): SelectionIntent {
  if (intent.kind !== "toggle") return intent;
  const touchesAMarker =
    kindOf(intent.instanceId) === "marker" ||
    selectedIds.some((instanceId) => kindOf(instanceId) === "marker");
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

  function resolveObjects(): SceneObject[] {
    const region = config.getRegion();
    if (!region) return [];
    return resolveSceneObjects(region, {
      activeScene: config.getActiveScene(),
      // The gizmo asks this for the object it is attaching to, so markers
      // have to be in the answer or selecting one finds nothing.
      includeMarkers: true,
      includeLights: true
    });
  }

  function getSceneObject(instanceId: string): SceneObject | null {
    return (
      resolveObjects().find((o: SceneObject) => o.instanceId === instanceId) ??
      null
    );
  }

  /**
   * The scene objects for a set of ids, in selection order. Resolving the
   * region's objects is a full rebuild, so this does it once and matches the
   * whole set against it rather than once per id.
   */
  function getSceneObjects(instanceIds: readonly string[]): SceneObject[] {
    const wanted = new Set(instanceIds);
    const found = new Map<string, SceneObject>();
    for (const object of resolveObjects()) {
      if (wanted.has(object.instanceId)) found.set(object.instanceId, object);
    }
    return instanceIds
      .map((instanceId) => found.get(instanceId))
      .filter((object): object is SceneObject => object !== undefined);
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
    for (const instanceId of config.getSelectedIds()) {
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

  /**
   * Whether the gizmo offers per-axis scale for this selection.
   *
   * Takes the objects rather than resolving them, so a caller that has already
   * resolved the selection asks the question against that same snapshot.
   */
  function axisScaleAvailable(objects: readonly SceneObject[]): boolean {
    return axisScaleBlockedBy(objects) === null;
  }

  /**
   * Show where a drag has put the selection, without committing it: a draft
   * per object, and the gizmo back at the pivot of where they now sit.
   * Cancelling uses the same path with the transforms the drag started from.
   */
  function showDrag(subjects: readonly DraggedSubject[]): void {
    for (const { instanceId, values } of subjects) {
      config.onPreviewTransform(
        instanceId,
        values.position,
        values.rotation,
        values.scale
      );
    }
    const pivot = medianPivot(
      subjects.map((subject) => subject.values.position)
    );
    if (!pivot) return;
    gizmo.setPosition(pivot);
    originMarker.setPosition(pivot);
  }

  function buildTransformController(initialCamera: THREE.Camera) {
    return createTransformController({
      hitTestService,
      getCamera: () => attachedCamera ?? initialCamera,
      getActiveTool: () => toolState.getState().activeTool,
      getSelectedIds: config.getSelectedIds,
      isAxisScaleAvailable: () =>
        axisScaleAvailable(getSceneObjects(config.getSelectedIds())),
      isSelectable: config.isSelectable,
      getTransform,
      onPreview: showDrag,
      onCommit(subjects) {
        const region = config.getRegion();
        if (!region) return;
        const target = {
          aggregateKind: "region-document" as const,
          aggregateId: region.identity.id
        };

        // One resolve for the whole drag. Asking per subject rebuilt every
        // scene object in the region once per dragged object.
        const kindById = new Map(
          getSceneObjects(subjects.map((subject) => subject.instanceId)).map(
            (object) => [object.instanceId, object.kind]
          )
        );
        const resolved = subjects.flatMap(({ instanceId, values }) => {
          const kind = kindById.get(instanceId);
          return kind
            ? [{ instanceId, values, commit: transformCommitFor(kind) }]
            : [];
        });

        // Markers carry a patch and everything else carries a transform, so
        // they go out as different commands. Each group is sent over its own
        // list rather than one being treated as the special case.
        for (const { instanceId, values } of resolved.filter(
          (entry) => entry.commit.via === "marker-patch"
        )) {
          config.onCommand(
            singleTransformCommand(
              "marker",
              region.identity.id,
              instanceId,
              values
            )
          );
        }

        const transformed = resolved.flatMap((entry) =>
          entry.commit.via === "transform"
            ? [
                {
                  subjectKind: entry.commit.subjectKind,
                  subjectId: entry.instanceId,
                  position: entry.values.position,
                  rotation: entry.values.rotation,
                  scale: entry.values.scale
                }
              ]
            : []
        );
        if (transformed.length > 0) {
          // One drag, one command, so one undo puts the whole selection back.
          config.onCommand({
            kind: "TransformSceneObjects",
            target,
            subject: {
              subjectKind: transformed[0].subjectKind,
              subjectId: transformed[0].subjectId
            },
            payload: { subjects: transformed }
          });
        }
      },
      onPreviewEnded(instanceIds) {
        config.onClearPreviewTransforms([...instanceIds]);
      },
      onCancel(subjects) {
        // The previews are dropped by onPreviewEnded; what is left is putting
        // the gizmo back where the drag started.
        const pivot = medianPivot(
          subjects.map((subject) => subject.values.position)
        );
        if (!pivot) return;
        gizmo.setPosition(pivot);
        originMarker.setPosition(pivot);
      },
      onSelect(intent) {
        const selectedIds = config.getSelectedIds();
        // One resolve for the click. Asking per id rebuilt the region's scene
        // objects once for every already-selected object, on every click.
        const kindById = new Map(
          getSceneObjects(
            intent.kind === "clear"
              ? selectedIds
              : [intent.instanceId, ...selectedIds]
          ).map((object) => [object.instanceId, object.kind])
        );
        config.onSelect(
          markersStayAlone(
            intent,
            selectedIds,
            (instanceId) => kindById.get(instanceId) ?? null
          )
        );
      },
      // Hover affordances arrive through the InputRouter's hover
      // dispatch (top controller only) -- never a raw DOM listener.
      onHoverHandle(handleName) {
        gizmo.setHoveredHandle(handleName);
      },
      onHoverTarget(object) {
        // Hover fires on every pointer move, and re-syncing walks the scene
        // graph once per selected object. Nothing changes while the cursor
        // stays over the same thing.
        if (object === hoveredObject) return;
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
      const selected = getSceneObjects(config.getSelectedIds());
      // One reading of the rule feeds both the greyed handles and the refusal
      // to drag them, so what is shown and what is allowed cannot disagree.
      gizmo.setAxisScaleAvailable(axisScaleAvailable(selected));
      const pivot = medianPivot(selected.map((o) => o.transform.position));
      if (!pivot) {
        gizmo.setVisible(false);
        originMarker.setVisible(false);
        return;
      }

      gizmo.setPosition(pivot);
      // Size comes from camera distance (updateForCamera), not the
      // object's scale -- the gizmo reads constant on screen.
      gizmo.setVisible(true);
      originMarker.setPosition(pivot);
      originMarker.setVisible(true);
    }
  };
}
