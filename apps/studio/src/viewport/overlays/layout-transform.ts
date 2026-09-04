/**
 * Layout transform overlay.
 *
 * Mounts the shared layout interaction controller into the viewport-owned
 * scene roots and connects its state/command edges to shell stores.
 *
 * The gizmo, pointer handlers and selection hit-test attach only where
 * `transformOverlayAttaches` says they belong -- Build > Layout and the Scene
 * Composer -- and detach otherwise, so clicks in the Landscape or Spatial
 * workspaces can't accidentally drag placed assets.
 */

import {
  applyCommand,
  getActiveRegion,
  getActiveScene,
  type SemanticCommand
} from "@sugarmagic/domain";
import { shallowEqual } from "@sugarmagic/shell";
import {
  createLayoutWorkspace,
  setLayoutWorkspaceForViewport,
  type SelectionIntent
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "../overlay-context";
import {
  isSelectableHere,
  transformOverlayAttaches
} from "./transform-overlay-gates";

export const mountTransformGizmoOverlay: ViewportOverlayFactory = (context) => {
  const layout = createLayoutWorkspace({
    onCommand(command: SemanticCommand) {
      const session = context.stateAccess.getSession();
      if (!session) return;
      context.stateAccess.updateSession(applyCommand(session, command));
    },
    onSelect(intent: SelectionIntent) {
      switch (intent.kind) {
        case "replace":
          context.stateAccess.setSelection([intent.instanceId]);
          return;
        case "toggle":
          context.stateAccess.toggleSelection(intent.instanceId);
          return;
        case "clear":
          context.stateAccess.clearSelection();
          return;
        default: {
          const unhandled: never = intent;
          console.warn(
            "[layout-transform] unhandled selection intent",
            unhandled
          );
        }
      }
    },
    onPreviewTransform(
      instanceId: string,
      position: [number, number, number],
      rotation: [number, number, number],
      scale: [number, number, number]
    ) {
      context.stateAccess.setTransformDraft(instanceId, {
        position,
        rotation,
        scale
      });
    },
    onClearPreviewTransforms(instanceIds: string[]) {
      for (const instanceId of instanceIds) {
        context.stateAccess.clearTransformDraft(instanceId);
      }
    },
    getSelectedIds() {
      return context.stateAccess.getSelectionIds();
    },
    getActiveId() {
      return context.stateAccess.getActiveSelectionId();
    },
    getRegion() {
      return context.stateAccess.getActiveRegion();
    },
    getActiveScene() {
      const session = context.stateAccess.getSession();
      return session ? getActiveScene(session) : null;
    },
    isSelectable(instanceId: string) {
      return isSelectableHere(
        context.stateAccess.getShellState(),
        context.stateAccess.getActiveRegion(),
        instanceId
      );
    }
  });

  let attached = false;

  const attachWorkspace = () => {
    if (attached) return;
    // Set the flag before attach() because attach may synchronously write
    // to stores (selection / preview-transform) that re-fire this
    // subscription. The reentrant listener must see attached=true.
    attached = true;
    layout.attach(
      context.domElement,
      context.getCamera(),
      context.authoredRoot,
      context.overlayRoot
    );
    setLayoutWorkspaceForViewport(context.domElement, layout);
  };

  const detachWorkspace = () => {
    if (!attached) return;
    // Same reason: detach() can fire onPreviewTransform / onSelect
    // callbacks during teardown, which write to stores and re-enter the
    // subscription. Flip the flag first so the reentrant call is a no-op.
    attached = false;
    setLayoutWorkspaceForViewport(context.domElement, null);
    layout.detach();
  };

  const unsubscribeFrame = context.subscribeFrame(() => {
    if (attached) {
      layout.updateForCamera(context.getCamera());
    }
  });

  const unsubscribeProjection = context.subscribeToProjection(
    ({ project, shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      activeStoryWorkspaceKind: shell.activeStoryWorkspaceKind,
      regionId: project.session
        ? (getActiveRegion(project.session)?.identity.id ?? null)
        : null,
      selectionIds: shell.selection.entityIds,
      // The active object is outlined differently from the rest, so a change
      // in which one is active has to redraw even when the same set stays
      // selected.
      activeSelectionId: shell.selection.activeEntityId,
      activeTool: viewport.activeTransformTool
    }),
    (slice) => {
      if (!transformOverlayAttaches(slice)) {
        detachWorkspace();
        return;
      }

      attachWorkspace();
      layout.toolState.setActiveTool(slice.activeTool);
      layout.syncOverlays();
    },
    { equalityFn: shallowEqual }
  );

  return () => {
    unsubscribeFrame();
    unsubscribeProjection();
    detachWorkspace();
    layout.dispose();
  };
};
