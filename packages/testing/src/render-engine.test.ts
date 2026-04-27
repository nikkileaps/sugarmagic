/**
 * Render-engine contract tests.
 *
 * Verifies the shared WebRenderEngine behavior promised by Epic 036 Stage 0:
 * attached views observe engine state changes together, detaching one view
 * does not starve the others, and project-switch resets clear project-scoped
 * authored state before the next project is pushed in.
 */

import { describe, expect, it, vi } from "vitest";
import type { RenderView, WebRenderLogger } from "@sugarmagic/render-web";
import { createWebRenderEngine } from "@sugarmagic/render-web";
import {
  createDefaultRegion,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";

function createSilentLogger(): WebRenderLogger {
  return {
    warn() {},
    debug() {}
  };
}

function createStubView(): RenderView {
  return {
    requestEngineStateSync: vi.fn(),
    markSceneMaterialsDirty: vi.fn()
  } as unknown as RenderView;
}

describe("WebRenderEngine", () => {
  it("notifies every attached view when shared authored state changes", () => {
    const engine = createWebRenderEngine({
      compileProfile: "authoring-preview",
      logger: createSilentLogger()
    });
    const firstView = createStubView();
    const secondView = createStubView();

    engine.attachView(firstView);
    engine.attachView(secondView);

    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const region = createDefaultRegion({
      regionId: "little-world:region:meadow",
      displayName: "Meadow",
      defaultEnvironmentId: "little-world:environment:default"
    });

    engine.setContentLibrary(contentLibrary);
    engine.setAssetSources({ "assets/grass.png": "blob:grass" });
    engine.setEnvironment(region, null);

    expect(firstView.requestEngineStateSync).toHaveBeenCalledTimes(4);
    expect(secondView.requestEngineStateSync).toHaveBeenCalledTimes(4);

    engine.dispose();
  });

  it("keeps remaining views alive when another view detaches", () => {
    const engine = createWebRenderEngine({
      compileProfile: "authoring-preview",
      logger: createSilentLogger()
    });
    const survivor = createStubView();
    const detached = createStubView();

    engine.attachView(survivor);
    engine.attachView(detached);
    vi.mocked(survivor.requestEngineStateSync).mockClear();
    vi.mocked(detached.requestEngineStateSync).mockClear();

    engine.detachView(detached);
    engine.setEnvironment(
      createDefaultRegion({
        regionId: "little-world:region:forest",
        displayName: "Forest",
        defaultEnvironmentId: "little-world:environment:default"
      }),
      null
    );

    expect(survivor.requestEngineStateSync).toHaveBeenCalledTimes(1);
    expect(detached.requestEngineStateSync).not.toHaveBeenCalled();

    engine.dispose();
  });

  it("drops project-scoped authored state on resetForProjectSwitch", () => {
    const engine = createWebRenderEngine({
      compileProfile: "authoring-preview",
      logger: createSilentLogger()
    });
    const view = createStubView();
    engine.attachView(view);

    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const region = createDefaultRegion({
      regionId: "little-world:region:field",
      displayName: "Field",
      defaultEnvironmentId: "little-world:environment:default"
    });

    engine.setContentLibrary(contentLibrary);
    engine.setAssetSources({
      "assets/shared.png": "blob:project-a",
      "assets/only-a.png": "blob:only-a"
    });
    engine.setEnvironment(region, null);

    expect(engine.assetResolver.resolveAssetUrl("assets/shared.png")).toBe(
      "blob:project-a"
    );

    vi.mocked(view.requestEngineStateSync).mockClear();
    engine.resetForProjectSwitch();

    expect(engine.getAssetSources()).toEqual({});
    expect(engine.assetResolver.resolveAssetUrl("assets/shared.png")).toBeNull();
    expect(engine.assetResolver.resolveAssetUrl("assets/only-a.png")).toBeNull();
    expect(engine.getEnvironmentState().region).toBeNull();
    expect(engine.getEnvironmentState().contentLibrary.identity.id).toBe(
      "render-engine:placeholder:content-library"
    );
    expect(view.requestEngineStateSync).toHaveBeenCalledTimes(1);

    engine.dispose();
  });
});
