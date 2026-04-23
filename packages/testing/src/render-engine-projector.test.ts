/**
 * Studio render-engine projector project-switch tests.
 *
 * Verifies the Studio-side projector is the one place where shell/project
 * state crosses into render-web, including the explicit
 * `resetForProjectSwitch` contract that prevents stale authored asset
 * sources from leaking across project changes.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { GameRootDescriptor } from "@sugarmagic/io";
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
  type ProjectionStores
} from "@sugarmagic/shell";
import { createWebRenderEngine } from "@sugarmagic/render-web";
import { connectStudioRenderEngineProjector } from "../../../apps/studio/src/viewport/RenderEngineProjector";

const TEST_DESCRIPTOR: GameRootDescriptor = {
  rootPath: "/tmp/test-project",
  projectFileName: "project.sgrmagic",
  authoredAssetsPath: "assets",
  exportsPath: "exports",
  publishPath: "publish"
};

const TEST_HANDLE = {} as FileSystemDirectoryHandle;

function createStores(): ProjectionStores {
  return {
    projectStore: createProjectStore(),
    shellStore: createShellStore(),
    viewportStore: createViewportStore(),
    assetSourceStore: createAssetSourceStore(),
    designPreviewStore: createDesignPreviewStore()
  };
}

function createSession(projectId: string) {
  const project = createDefaultGameProject(projectId, projectId);
  const region = createDefaultRegion({
    regionId: `${projectId}:region:default`,
    displayName: "Default Region",
    defaultEnvironmentId: `${projectId}:environment:default`
  });
  return createAuthoringSession(project, [region]);
}

describe("Studio render-engine projector project switching", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("resets the engine once per project switch and does not keep stale asset urls", () => {
    const stores = createStores();
    const engine = createWebRenderEngine({ compileProfile: "authoring-preview" });
    let resetCount = 0;
    const assetSourcesAtReset: Record<string, string>[] = [];
    const assetSourcesAfterReset: Record<string, string>[] = [];
    const originalReset = engine.resetForProjectSwitch.bind(engine);

    engine.resetForProjectSwitch = () => {
      resetCount += 1;
      assetSourcesAtReset.push({ ...engine.getAssetSources() });
      originalReset();
      assetSourcesAfterReset.push({ ...engine.getAssetSources() });
    };

    stores.projectStore.getState().setActive(
      TEST_HANDLE,
      TEST_DESCRIPTOR,
      createSession("project-a")
    );
    stores.assetSourceStore.setState({
      sources: {
        "assets/shared.png": "blob:project-a-shared",
        "assets/only-a.png": "blob:project-a-only"
      },
      syncCount: 1
    });

    cleanup = connectStudioRenderEngineProjector({ engine, stores });

    expect(resetCount).toBe(1);
    expect(engine.assetResolver.resolveAssetUrl("assets/shared.png")).toBe(
      "blob:project-a-shared"
    );
    expect(engine.assetResolver.resolveAssetUrl("assets/only-a.png")).toBe(
      "blob:project-a-only"
    );

    stores.projectStore.getState().setActive(
      TEST_HANDLE,
      TEST_DESCRIPTOR,
      createSession("project-b")
    );
    stores.assetSourceStore.setState({
      sources: {
        "assets/shared.png": "blob:project-b-shared"
      },
      syncCount: 2
    });

    expect(resetCount).toBe(2);
    expect(assetSourcesAtReset[1]).toEqual({
      "assets/shared.png": "blob:project-a-shared",
      "assets/only-a.png": "blob:project-a-only"
    });
    expect(assetSourcesAfterReset[1]).toEqual({});
    expect(engine.getAssetSources()).toEqual({
      "assets/shared.png": "blob:project-b-shared"
    });
    expect(engine.assetResolver.resolveAssetUrl("assets/shared.png")).toBe(
      "blob:project-b-shared"
    );
    expect(engine.assetResolver.resolveAssetUrl("assets/only-a.png")).toBeNull();

    engine.dispose();
  });
});
