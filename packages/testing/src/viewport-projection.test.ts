import { describe, expect, it } from "vitest";
import {
  mapEpisodes,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  switchActiveRegion
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

  it("carries showGrid through to the projection, defaulting ON", () => {
    // The grid is an authoring aid that is always on until the author clears it
    // for a camera-framed shot, so the default is the inverse of the collider /
    // navmesh toggles. Guards the store -> projection link: a field added to the
    // store but not the projection builder leaves the button inert with no
    // type error anywhere.
    const gameProject = createDefaultGameProject("Sugarmagic Test", "little-world");
    const region = createDefaultRegion({ regionId: "glade", displayName: "Glade" });
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

    const project = () =>
      selectViewportProjection(
        projectStore.getState(),
        shellStore.getState(),
        viewportStore.getState(),
        assetSourceStore.getState()
      );

    expect(project().showGrid).toBe(true);
    expect(project().showColliders).toBe(false);

    viewportStore.getState().setShowGrid(false);
    expect(project().showGrid).toBe(false);

    viewportStore.getState().setShowGrid(true);
    expect(project().showGrid).toBe(true);
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

/**
 * Which region the viewport shows (epic #226 story 8).
 *
 * Build's region dropdown answers "what am I editing". The scene
 * composer's region is not a choice at all -- a Scene names its region,
 * so the composer derives it. Keeping a second copy in shell state is
 * how Build's dropdown ended up dragging the composer to a region the
 * Scene does not happen in.
 */
describe("the composer's region comes from its Scene", () => {
  function harness() {
    const gameProject = createDefaultGameProject("Test", "test");
    const station = createDefaultRegion({
      regionId: "station",
      displayName: "Station"
    });
    const harbour = createDefaultRegion({
      regionId: "harbour",
      displayName: "Harbour"
    });
    const withScene = {
      ...gameProject,
      seasons: mapEpisodes(gameProject.seasons, (episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => ({
          ...scene,
          regionId: "station"
        }))
      }))
    };
    // Build's dropdown writes BOTH stores (`handleRegionSelect`), and
    // the session's is what the viewport reads -- so point it away from
    // the Scene's region the way selecting Harbour in Build would.
    const session = switchActiveRegion(
      createAuthoringSession(withScene, [station, harbour]),
      "harbour"
    );

    const projectStore = createProjectStore();
    const shellStore = createShellStore("story");
    const viewportStore = createViewportStore();
    const assetSourceStore = createAssetSourceStore();
    projectStore.getState().setActive(
      {} as FileSystemDirectoryHandle,
      { gameRootPath: "." } as never,
      session
    );
    shellStore.getState().setActiveRegionId("harbour");
    return { projectStore, shellStore, viewportStore, assetSourceStore };
  }

  it("shows the Scene's region, not the one Build has selected", () => {
    const h = harness();
    h.shellStore.getState().setActiveStoryWorkspaceKind("composer");

    const projection = selectViewportProjection(
      h.projectStore.getState(),
      h.shellStore.getState(),
      h.viewportStore.getState(),
      h.assetSourceStore.getState()
    );

    expect(projection.region?.identity.id).toBe("station");
  });

  it("outside the composer, Build's selection still rules", () => {
    const h = harness();
    h.shellStore.getState().setActiveProductMode("build");

    const projection = selectViewportProjection(
      h.projectStore.getState(),
      h.shellStore.getState(),
      h.viewportStore.getState(),
      h.assetSourceStore.getState()
    );

    expect(projection.region?.identity.id).toBe("harbour");
  });
});
