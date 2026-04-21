/**
 * Landscape authoring overlay.
 *
 * Re-homes the landscape workspace's cursor, hit testing, and paint
 * interaction inside the viewport while keeping the draft landscape as store
 * state instead of a workspace-owned imperative side path.
 *
 * Gated on `activeBuildWorkspaceKind === "landscape"`: the brush cursor,
 * pointer handlers, and paint routine attach only while the author is in the
 * Landscape workspace and detach otherwise, so dragging a tree in the Layout
 * workspace can't accidentally paint on the ground plane.
 */

import {
  applyCommand,
  serializeLandscapePaintPayload,
  type RegionLandscapePaintPayload,
  type RegionLandscapeState
} from "@sugarmagic/domain";
import { shallowEqual } from "@sugarmagic/shell";
import {
  createLandscapeWorkspace,
  type LandscapeBrushSettings,
  type LandscapeWorkspaceConfig
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "../overlay-context";

const DEFAULT_BRUSH_SETTINGS: LandscapeBrushSettings = {
  radius: 4,
  strength: 0.25,
  falloff: 0.7,
  mode: "paint"
};

function resolveLandscapeDraft(
  context: Parameters<ViewportOverlayFactory>[0]
): RegionLandscapeState | null {
  const region = context.stateAccess.getActiveRegion();
  if (!region) {
    return null;
  }
  return context.stateAccess.getLandscapeDraft() ?? region.landscape;
}

export const mountLandscapeAuthoringOverlay: ViewportOverlayFactory = (context) => {
  const workspace = createLandscapeWorkspace({
    getLandscape() {
      return resolveLandscapeDraft(context);
    },
    previewLandscape(landscape: RegionLandscapeState) {
      context.stateAccess.setLandscapeDraft(landscape);
    },
    paintLandscapeAt(
      options: Parameters<LandscapeWorkspaceConfig["paintLandscapeAt"]>[0]
    ) {
      const region = context.stateAccess.getActiveRegion();
      if (!region) {
        return false;
      }
      return context.stateAccess.paintLandscape(region.landscape, options);
    },
    serializePaintPayload() {
      const landscape = resolveLandscapeDraft(context);
      return landscape ? serializeLandscapePaintPayload(landscape) : null;
    },
    commitPaint(
      paintPayload: RegionLandscapePaintPayload | null,
      affectedBounds: [number, number, number, number]
    ) {
      const session = context.stateAccess.getSession();
      const region = context.stateAccess.getActiveRegion();
      if (!session || !region) {
        return;
      }
      const nextSession = applyCommand(session, {
        kind: "PaintLandscape",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "region-landscape",
          subjectId: region.identity.id
        },
        payload: {
          paintPayload,
          affectedBounds
        }
      });
      context.stateAccess.updateSession(nextSession);
      context.stateAccess.clearLandscapeDraft();
    },
    onPreviewTick() {}
  });

  let attached = false;

  const attachWorkspace = () => {
    if (attached) return;
    // Set the flag before calling attach. attach may synchronously trigger
    // store writes (e.g. syncLandscape seeding the preview draft) that
    // re-fire the projection subscription; the guard must already reflect
    // the in-progress state so the reentrant listener is a no-op.
    attached = true;
    workspace.attach(
      context.domElement,
      context.getCamera(),
      context.authoredRoot,
      context.overlayRoot,
      context.surfaceRoot
    );
  };

  const detachWorkspace = () => {
    if (!attached) return;
    // Same reason as attachWorkspace: workspace.detach() synchronously
    // calls previewLandscape(null) to clear the draft, which writes to
    // viewportStore and re-fires this subscription. Flipping the flag
    // first makes the reentrant detachWorkspace() early-return.
    attached = false;
    workspace.detach();
  };

  const unsubscribeProjection = context.subscribeToProjection(
    ({ project, shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      regionId: project.session
        ? context.stateAccess.getActiveRegion()?.identity.id ?? null
        : null,
      landscape: resolveLandscapeDraft(context),
      activeChannelIndex: viewport.activeLandscapeChannelIndex,
      brushSettings: viewport.brushSettings
    }),
    (slice) => {
      const isActive =
        slice.activeProductMode === "build" &&
        slice.activeBuildWorkspaceKind === "landscape";
      if (!isActive) {
        detachWorkspace();
        return;
      }

      attachWorkspace();
      workspace.setActiveChannelIndex(slice.activeChannelIndex);
      workspace.setBrushSettings(slice.brushSettings ?? DEFAULT_BRUSH_SETTINGS);
      workspace.syncLandscape();
    },
    { equalityFn: shallowEqual }
  );

  return () => {
    unsubscribeProjection();
    detachWorkspace();
  };
};
