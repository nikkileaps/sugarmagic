import { describe, expect, it } from "vitest";
import {
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion
} from "@sugarmagic/domain";
import {
  createAssetSourceStore,
  createDesignPreviewStore,
  createProjectStore,
  createShellStore,
  createViewportStore,
  selectPlayerPreviewProjection,
  selectViewportProjection,
  subscribeToProjection
} from "@sugarmagic/shell";

describe("viewport projection", () => {
  it("merges canonical authored state with transient viewport drafts", () => {
    const gameProject = createDefaultGameProject("Sugarmagic Test", "little-world");
    const region = createDefaultRegion({
      regionId: "glade",
      displayName: "Glade"
    });
    const session = createAuthoringSession(gameProject, [region]);

    const projectStore = createProjectStore();
    const shellStore = createShellStore("build");
    const viewportStore = createViewportStore();
    const assetSourceStore = createAssetSourceStore();
    projectStore.getState().setActive(
      {} as FileSystemDirectoryHandle,
      { gameRootPath: "." } as never,
      session
    );
    shellStore.getState().setActiveRegionId(region.identity.id);
    shellStore.getState().setActiveEnvironmentId("env:golden-hour");
    shellStore.getState().setSelection(["placed-asset:tree"]);
    viewportStore.getState().setLandscapeDraft({
      ...region.landscape,
      size: 144
    });
    viewportStore.getState().setTransformDraft("placed-asset:tree", {
      position: [1, 2, 3],
      rotation: [0, 1, 0],
      scale: [2, 2, 2]
    });

    const projection = selectViewportProjection(
      projectStore.getState(),
      shellStore.getState(),
      viewportStore.getState(),
      assetSourceStore.getState()
    );

    expect(projection.region?.identity.id).toBe(region.identity.id);
    expect(projection.contentLibrary?.identity.id).toBe(gameProject.contentLibraryId);
    expect(projection.environmentOverrideId).toBe("env:golden-hour");
    expect(projection.selection.entityIds).toEqual(["placed-asset:tree"]);
    expect(projection.landscapeOverride?.size).toBe(144);
    expect(projection.transformOverrides["placed-asset:tree"]).toEqual({
      position: [1, 2, 3],
      rotation: [0, 1, 0],
      scale: [2, 2, 2]
    });
  });

  it("subscribes once to the combined store bundle and emits deterministic slices", () => {
    const gameProject = createDefaultGameProject("Sugarmagic Test", "little-world");
    const session = createAuthoringSession(gameProject, [
      createDefaultRegion({
        regionId: "glade",
        displayName: "Glade"
      })
    ]);

    const projectStore = createProjectStore();
    const shellStore = createShellStore("design");
    const viewportStore = createViewportStore();
    const assetSourceStore = createAssetSourceStore();
    const designPreviewStore = createDesignPreviewStore();

    projectStore.getState().setActive(
      {} as FileSystemDirectoryHandle,
      { gameRootPath: "." } as never,
      session
    );

    const seenAnimationSlots: Array<string | null> = [];
    const unsubscribe = subscribeToProjection(
      {
        projectStore,
        shellStore,
        viewportStore,
        assetSourceStore,
        designPreviewStore
      },
      ({ project, shell, designPreview, assetSources }) =>
        selectPlayerPreviewProjection(project, shell, designPreview, assetSources),
      (projection) => {
        seenAnimationSlots.push(projection.animationSlot);
      }
    );

    designPreviewStore
      .getState()
      .beginPreview(session.gameProject.playerDefinition.definitionId);
    designPreviewStore.getState().setAnimationSlot("idle");
    designPreviewStore.getState().endPreview();
    unsubscribe();

    expect(seenAnimationSlots).toEqual([null, null, "idle", null]);
  });

  it("does not notify preview subscribers when camera framing is rewritten with identical values", () => {
    const designPreviewStore = createDesignPreviewStore();
    const notifications: Array<string> = [];

    const unsubscribe = designPreviewStore.subscribe((state) => {
      notifications.push(
        state.cameraFraming
          ? `${state.cameraFraming.orbitDistance}:${state.cameraFraming.quaternion.join(",")}`
          : "null"
      );
    });

    designPreviewStore.getState().setCameraFraming({
      quaternion: [0, 0, 0, 1],
      orbitDistance: 3,
      target: [0, 1, 0]
    });
    designPreviewStore.getState().setCameraFraming({
      quaternion: [0, 0, 0, 1],
      orbitDistance: 3,
      target: [0, 1, 0]
    });

    unsubscribe();

    expect(notifications).toEqual(["3:0,0,0,1"]);
  });
});
