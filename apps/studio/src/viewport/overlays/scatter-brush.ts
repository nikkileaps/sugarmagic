/**
 * Scatter brush overlay (Plan 065.2).
 *
 * Mounts the Layout workspace's scatter/prop paint brush inside the
 * viewport. Gated on the Layout workspace being active AND the brush
 * tool being armed (`viewport.scatterBrushSettings` non-null), so the
 * brush can never hijack normal select/move interactions.
 *
 * Strokes commit through the semantic command path: one
 * BrushPlaceAssets / BrushEraseAssets command per stroke = one undo
 * step per stroke.
 */

import {
  applyCommand,
  createPlacedAssetInstanceId,
  createSceneFolderId,
  getActiveScene,
  type BrushPlacement
} from "@sugarmagic/domain";
import { shallowEqual } from "@sugarmagic/shell";
import {
  createScatterBrushTool,
  getLayoutWorkspaceForViewport
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "../overlay-context";

export const mountScatterBrushOverlay: ViewportOverlayFactory = (context) => {
  // One auto-folder per brush arm-session (Plan 065.2d): strokes made
  // while the brush stays armed land in the same folder, so a spraying
  // session collapses to one Scene Explorer row instead of flooding it
  // with identical entries. Disarm and re-arm to start a new patch.
  // The folder id is minted lazily on the first stroke; the executor
  // creates the folder in the SAME transaction as the placements, so
  // undoing the first stroke removes the folder too.
  let sessionFolder: { folderId: string; displayName: string } | null = null;

  function resolveSessionFolder(
    paletteAssetDefinitionIds: string[]
  ): { folderId: string; displayName: string } {
    if (sessionFolder) {
      return sessionFolder;
    }
    const session = context.stateAccess.getSession();
    const region = context.stateAccess.getActiveRegion();
    const firstAssetId = paletteAssetDefinitionIds[0] ?? null;
    const firstAssetName =
      (firstAssetId &&
        session?.contentLibrary.assetDefinitions.find(
          (candidate) => candidate.definitionId === firstAssetId
        )?.displayName) ||
      "Scatter";
    const baseName = `${firstAssetName} patch`;
    const takenNames = new Set(
      (region?.folders ?? []).map((folder) => folder.displayName)
    );
    let displayName = baseName;
    let counter = 2;
    while (takenNames.has(displayName)) {
      displayName = `${baseName} ${counter}`;
      counter += 1;
    }
    sessionFolder = { folderId: createSceneFolderId(), displayName };
    return sessionFolder;
  }

  const tool = createScatterBrushTool({
    getPlacedAssets() {
      const session = context.stateAccess.getSession();
      const region = context.stateAccess.getActiveRegion();
      if (!session || !region) {
        return [];
      }
      const overlayAssets =
        (session &&
          getActiveScene(session)?.regionOverlays[region.identity.id]
            ?.placedAssets) ??
        [];
      return [...region.placedAssets, ...overlayAssets].map((asset) => ({
        instanceId: asset.instanceId,
        position: asset.transform.position
      }));
    },
    getAssetDisplayName(assetDefinitionId) {
      const session = context.stateAccess.getSession();
      const definition = session?.contentLibrary.assetDefinitions.find(
        (candidate) => candidate.definitionId === assetDefinitionId
      );
      return definition?.displayName ?? "Prop";
    },
    createInstanceId(displayNameStem) {
      return createPlacedAssetInstanceId(displayNameStem);
    },
    commitPlacements(placements: BrushPlacement[]) {
      const session = context.stateAccess.getSession();
      const region = context.stateAccess.getActiveRegion();
      if (!session || !region || placements.length === 0) {
        return;
      }
      const folder = resolveSessionFolder(
        placements.map((placement) => placement.assetDefinitionId)
      );
      const nextSession = applyCommand(session, {
        kind: "BrushPlaceAssets",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "placed-asset",
          subjectId: placements[0]!.instanceId
        },
        payload: {
          placements,
          // v1 lands in the region base (always-visible) layer; the
          // Scope dropdown / overlay-scoped brushing is a follow-up.
          parentFolderId: null,
          createFolder: folder
        }
      });
      context.stateAccess.updateSession(nextSession);
    },
    commitErase(instanceIds: string[]) {
      const session = context.stateAccess.getSession();
      const region = context.stateAccess.getActiveRegion();
      if (!session || !region || instanceIds.length === 0) {
        return;
      }
      const nextSession = applyCommand(session, {
        kind: "BrushEraseAssets",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "placed-asset",
          subjectId: instanceIds[0]!
        },
        payload: { instanceIds }
      });
      context.stateAccess.updateSession(nextSession);
    }
  });

  let attached = false;
  let wantsAttach = false;

  const attachTool = () => {
    if (attached) return;
    // The brush joins the LAYOUT WORKSPACE'S input router (top
    // controller wins; a second router would double-dispatch). The
    // layout workspace registers itself per viewport element and may
    // mount a beat after this overlay's projection fires -- the frame
    // subscription below retries until it exists.
    const layoutWorkspace = getLayoutWorkspaceForViewport(context.domElement);
    if (!layoutWorkspace) return;
    attached = true;
    tool.attach({
      viewportElement: context.domElement,
      inputRouter: layoutWorkspace.inputRouter,
      camera: context.getCamera(),
      authoredRoot: context.authoredRoot,
      surfaceRoot: context.surfaceRoot,
      overlayRoot: context.overlayRoot
    });
  };

  const detachTool = () => {
    if (!attached) return;
    attached = false;
    tool.detach();
    // Next arm-session sprays into a fresh folder.
    sessionFolder = null;
  };

  const unsubscribeFrame = context.subscribeFrame(() => {
    if (wantsAttach && !attached) {
      attachTool();
    }
  });

  const unsubscribeProjection = context.subscribeToProjection(
    ({ shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      scatterBrushSettings: viewport.scatterBrushSettings
    }),
    (slice) => {
      const isActive =
        slice.activeProductMode === "build" &&
        slice.activeBuildWorkspaceKind === "layout" &&
        slice.scatterBrushSettings !== null;
      wantsAttach = isActive;
      if (!isActive) {
        detachTool();
        return;
      }
      attachTool();
      tool.setSettings(slice.scatterBrushSettings!);
    },
    { equalityFn: shallowEqual }
  );

  return () => {
    unsubscribeProjection();
    unsubscribeFrame();
    detachTool();
  };
};
