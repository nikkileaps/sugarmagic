import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createDefaultEnvironmentDefinition,
  createDefaultRegionLandscapeState,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";
import {
  applyLightingPresetToEnvironmentDefinition,
  createRuntimeEnvironmentState,
  createEnvironmentSceneController,
  resolveEnvironmentDefinition
} from "@sugarmagic/runtime-core";

function makeContentLibrary(): ContentLibrarySnapshot {
  return {
    identity: {
      id: "project:content-library",
      schema: "ContentLibrary",
      version: 1
    },
    assetDefinitions: [],
    environmentDefinitions: [
      createDefaultEnvironmentDefinition("project", {
        definitionId: "project:environment:day",
        displayName: "Day"
      }),
      createDefaultEnvironmentDefinition("project", {
        definitionId: "project:environment:night",
        displayName: "Night",
        preset: "night"
      })
    ]
  };
}

function makeRegion(): RegionDocument {
  return {
    identity: { id: "region-a", schema: "RegionDocument", version: 1 },
    displayName: "Region A",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: { folders: [], placedAssets: [], playerPresence: null, npcPresences: [], itemPresences: [] },
    environmentBinding: { defaultEnvironmentId: "project:environment:night" },
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
}

describe("environment runtime controller", () => {
  it("resolves region environment bindings through the content library", () => {
    const contentLibrary = makeContentLibrary();
    const resolved = resolveEnvironmentDefinition(makeRegion(), contentLibrary);
    expect(resolved?.definitionId).toBe("project:environment:night");
  });

  it("applies a lighting preset update with shared preset semantics", () => {
    const contentLibrary = makeContentLibrary();
    const definition = contentLibrary.environmentDefinitions[0]!;
    const updated = applyLightingPresetToEnvironmentDefinition(
      definition,
      "golden_hour"
    );

    expect(updated.lighting.preset).toBe("golden_hour");
    expect(updated.atmosphere.fog.density).toBeGreaterThan(0);
    expect(updated.atmosphere.sky.topColor).not.toBe(definition.atmosphere.sky.topColor);
  });

  it("models active environment as runtime-owned state with explicit override precedence", () => {
    const contentLibrary = makeContentLibrary();
    const runtimeEnvironmentState = createRuntimeEnvironmentState({
      region: makeRegion(),
      contentLibrary,
      explicitEnvironmentId: "project:environment:day"
    });

    expect(runtimeEnvironmentState.activeEnvironmentId).toBe(
      "project:environment:day"
    );
  });

  it("applies sky, fog, and shared runtime lights to a scene", () => {
    const scene = new THREE.Scene();
    const controller = createEnvironmentSceneController(scene);
    const result = controller.apply(makeRegion(), makeContentLibrary());

    expect(result.definitionId).toBe("project:environment:night");
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect(scene.children.some((child) => child instanceof THREE.Light)).toBe(true);
  });
});
