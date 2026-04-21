/**
 * Layout transform overlay.
 *
 * Mounts the shared layout interaction controller into the viewport-owned
 * scene roots and connects its state/command edges to shell stores.
 *
 * Gated on `activeBuildWorkspaceKind === "layout"`: the gizmo, pointer
 * handlers, and selection hit-test attach only while the author is in the
 * Layout workspace and detach otherwise, so clicks in the Landscape or
 * Spatial workspaces can't accidentally drag placed assets.
 */

import {
  applyCommand,
  getActiveRegion,
  type SemanticCommand
} from "@sugarmagic/domain";
import { shallowEqual } from "@sugarmagic/shell";
import {
  createLayoutWorkspace,
  setLayoutWorkspaceForViewport
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "../overlay-context";

export const mountTransformGizmoOverlay: ViewportOverlayFactory = (context) => {
  const layout = createLayoutWorkspace({
    onCommand(command: SemanticCommand) {
      const session = context.stateAccess.getSession();
      if (!session) return;
      context.stateAccess.updateSession(applyCommand(session, command));
    },
    onSelect(entityIds: string[]) {
      context.stateAccess.setSelection(entityIds);
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
    getSelectedId() {
      return context.stateAccess.getSelectionIds()[0] ?? null;
    },
    getRegion() {
      return context.stateAccess.getActiveRegion();
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

  const unsubscribeProjection = context.subscribeToProjection(
    ({ project, shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      regionId: project.session
        ? getActiveRegion(project.session)?.identity.id ?? null
        : null,
      selectionIds: shell.selection.entityIds,
      activeTool: viewport.activeTransformTool
    }),
    (slice) => {
      const isActive =
        slice.activeProductMode === "build" &&
        slice.activeBuildWorkspaceKind === "layout";
      if (!isActive) {
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
    unsubscribeProjection();
    detachWorkspace();
  };
};
