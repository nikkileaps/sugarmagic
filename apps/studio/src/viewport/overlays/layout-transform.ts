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
  getActiveScene,
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
    /**
     * In the scene composer the region is shown but not edited: an
     * author sees where the station is while placing what this Scene
     * adds to it (epic #226). Everywhere else -- Build -- every drawn
     * object is editable, which is what returning true means.
     */
    isSelectable(instanceId: string) {
      const shell = context.stateAccess.getShellState?.();
      const inComposer =
        shell?.activeProductMode === "story" &&
        shell?.activeStoryWorkspaceKind === "composer";
      if (!inComposer) return true;
      const region = context.stateAccess.getActiveRegion();
      if (!region) return true;
      const regionOwned =
        region.placedAssets.some((asset) => asset.instanceId === instanceId) ||
        region.npcPresences.some((p) => p.presenceId === instanceId) ||
        region.itemPresences.some((p) => p.presenceId === instanceId) ||
        region.playerPresence?.presenceId === instanceId;
      return !regionOwned;
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
    unsubscribeFrame();
    unsubscribeProjection();
    detachWorkspace();
    layout.dispose();
  };
};
