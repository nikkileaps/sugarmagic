/**
 * Spatial authoring overlay.
 *
 * Re-homes the spatial area visuals and draw interaction inside the viewport
 * while keeping the selected area and active tool in shell/viewport state.
 */

import {
  applyCommand,
  createRegionAreaBounds,
  getActiveRegion
} from "@sugarmagic/domain";
import {
  createSpatialWorkspace,
  type SpatialWorkspaceConfig,
  setSpatialWorkspaceForViewport
} from "@sugarmagic/workspaces";
import { shallowEqual } from "@sugarmagic/shell";
import type { ViewportOverlayFactory } from "../overlay-context";

export const mountSpatialAuthoringOverlay: ViewportOverlayFactory = (context) => {
  const workspace = createSpatialWorkspace({
    getAreas() {
      return context.stateAccess.getActiveRegion()?.areas ?? [];
    },
    getSelectedAreaId() {
      return context.stateAccess.getSelectionIds()[0] ?? null;
    },
    onCreateAreaRectangle({
      minX,
      minZ,
      maxX,
      maxZ
    }: Parameters<SpatialWorkspaceConfig["onCreateAreaRectangle"]>[0]) {
      const session = context.stateAccess.getSession();
      const region = context.stateAccess.getActiveRegion();
      const selectedAreaId = context.stateAccess.getSelectionIds()[0] ?? null;
      if (!session || !region || !selectedAreaId) {
        return;
      }
      const selectedArea = region.areas.find(
        (area) => area.areaId === selectedAreaId
      );
      if (!selectedArea) {
        return;
      }
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const centerX = minX + width / 2;
      const centerZ = minZ + depth / 2;
      context.stateAccess.updateSession(
        applyCommand(session, {
          kind: "UpdateRegionArea",
          target: {
            aggregateKind: "region-document",
            aggregateId: region.identity.id
          },
          subject: {
            subjectKind: "region-area",
            subjectId: selectedAreaId
          },
          payload: {
            areaId: selectedAreaId,
            bounds: createRegionAreaBounds({
              center: [centerX, selectedArea.bounds.center[1], centerZ],
              size: [width, selectedArea.bounds.size[1], depth]
            })
          }
        })
      );
    }
  });

  let attached = false;

  const attachWorkspace = () => {
    if (attached) {
      workspace.hitTestService.setCamera(context.getCamera());
      return;
    }
    // Set the flag before the side-effectful work so any synchronous
    // store write triggered by attach (which would re-fire this
    // subscription) sees attached=true and is a no-op.
    attached = true;
    workspace.attach(
      context.domElement,
      context.getCamera(),
      context.authoredRoot,
      context.overlayRoot,
      context.surfaceRoot
    );
    setSpatialWorkspaceForViewport(context.domElement, workspace);
  };

  const detachWorkspace = () => {
    if (!attached) {
      return;
    }
    // Same reason: detach may synchronously clear selections / drafts
    // and re-enter this listener. Flip the flag first so the reentrant
    // call is a no-op.
    attached = false;
    setSpatialWorkspaceForViewport(context.domElement, null);
    workspace.detach();
  };

  const unsubscribeProjection = context.subscribeToProjection(
    ({ project, shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      selectionIds: shell.selection.entityIds,
      regionId: project.session ? getActiveRegion(project.session)?.identity.id ?? null : null,
      activeTool: viewport.activeSpatialTool
    }),
    ({
      activeProductMode,
      activeBuildWorkspaceKind,
      activeTool
    }) => {
      const isActive =
        activeProductMode === "build" && activeBuildWorkspaceKind === "spatial";
      if (!isActive) {
        detachWorkspace();
        return;
      }

      attachWorkspace();
      workspace.hitTestService.setCamera(context.getCamera());
      workspace.setDrawingEnabled(activeTool === "draw-rect");
      workspace.syncAreas();
    },
    { equalityFn: shallowEqual }
  );

  return () => {
    unsubscribeProjection();
    detachWorkspace();
  };
};
