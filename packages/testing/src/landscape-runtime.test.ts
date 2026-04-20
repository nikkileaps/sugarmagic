import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ContentLibrarySnapshot, RegionDocument } from "@sugarmagic/domain";
import {
  createDefaultStandardPbrShaderGraph,
  createDefaultRegionLandscapeState,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import {
  resolveLandscapeDescriptor
} from "@sugarmagic/runtime-core";
import {
  createAuthoredAssetResolver,
  createLandscapeSceneController,
  ShaderRuntime
} from "@sugarmagic/render-web";

function makeRegion(enabled = true): RegionDocument {
  return {
    identity: { id: "region-landscape", schema: "RegionDocument", version: 1 },
    displayName: "Landscape Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: { folders: [], placedAssets: [], playerPresence: null, npcPresences: [], itemPresences: [] },
    environmentBinding: { defaultEnvironmentId: null },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled }),
    markers: [],
    gameplayPlacements: []
  };
}

function makeLandscapeMaterialLibrary(): ContentLibrarySnapshot {
  const snapshot = createEmptyContentLibrarySnapshot("wordlark");
  return {
    ...snapshot,
    shaderDefinitions: [createDefaultStandardPbrShaderGraph("wordlark")],
    textureDefinitions: [
      {
        definitionId: "wordlark:texture:grass-base",
        definitionKind: "texture",
        displayName: "Grass Base",
        source: {
          relativeAssetPath: "assets/textures/grass-base.png",
          fileName: "grass-base.png",
          mimeType: "image/png"
        },
        colorSpace: "srgb",
        packing: "rgba"
      },
      {
        definitionId: "wordlark:texture:grass-normal",
        definitionKind: "texture",
        displayName: "Grass Normal",
        source: {
          relativeAssetPath: "assets/textures/grass-normal.png",
          fileName: "grass-normal.png",
          mimeType: "image/png"
        },
        colorSpace: "linear",
        packing: "normal"
      },
      {
        definitionId: "wordlark:texture:grass-orm",
        definitionKind: "texture",
        displayName: "Grass ORM",
        source: {
          relativeAssetPath: "assets/textures/grass-orm.png",
          fileName: "grass-orm.png",
          mimeType: "image/png"
        },
        colorSpace: "linear",
        packing: "orm"
      }
    ],
    materialDefinitions: [
      {
        definitionId: "wordlark:material:grass",
        definitionKind: "material",
        displayName: "Grass",
        shaderDefinitionId: "wordlark:shader:standard-pbr",
        parameterValues: {
          tiling: [2, 2],
          roughness_scale: 0.9,
          metallic_scale: 0
        },
        textureBindings: {
          basecolor_texture: "wordlark:texture:grass-base",
          normal_texture: "wordlark:texture:grass-normal",
          orm_texture: "wordlark:texture:grass-orm"
        }
      }
    ]
  };
}

describe("landscape runtime controller", () => {
  it("resolves a runtime descriptor from canonical region landscape state", () => {
    const descriptor = resolveLandscapeDescriptor(makeRegion());

    expect(descriptor?.owner).toBe("runtime-core");
    expect(descriptor?.enabled).toBe(true);
    expect(descriptor?.size).toBeGreaterThan(0);
    expect(descriptor?.subdivisions).toBeGreaterThan(0);
  });

  it("creates and removes the shared landscape plane from the scene", () => {
    const scene = new THREE.Scene();
    const controller = createLandscapeSceneController(scene);

    const result = controller.apply(makeRegion(true));
    expect(result.descriptor?.enabled).toBe(true);
    expect(controller.root.children).toHaveLength(1);

    controller.apply(makeRegion(false));
    expect(controller.root.children).toHaveLength(0);

    controller.dispose();
    expect(scene.children.includes(controller.root)).toBe(false);
  });

  it("serializes painted splatmap payloads and reapplies them through the same runtime path", () => {
    const firstScene = new THREE.Scene();
    const firstController = createLandscapeSceneController(firstScene);
    const region = makeRegion(true);

    firstController.apply(region);
    const painted = firstController.paintStroke({
      channelIndex: 1,
      worldX: 2,
      worldZ: -1.5,
      radius: 4,
      strength: 0.3,
      falloff: 0.7
    });

    expect(painted).toBe(true);
    const paintPayload = firstController.serializePaintPayload();
    expect(paintPayload).not.toBeNull();
    expect(paintPayload?.layers.length).toBeGreaterThan(0);

    const secondScene = new THREE.Scene();
    const secondController = createLandscapeSceneController(secondScene);
    secondController.apply({
      ...region,
      landscape: {
        ...region.landscape,
        paintPayload
      }
    });

    expect(secondController.root.children).toHaveLength(1);

    firstController.dispose();
    secondController.dispose();
  });

  it("realizes material-mode landscape channels through the shared render-web mesh", () => {
    const scene = new THREE.Scene();
    const contentLibrary = makeLandscapeMaterialLibrary();
    const assetResolver = createAuthoredAssetResolver();
    const fileSources = {
      "assets/textures/grass-base.png": "blob:grass-base",
      "assets/textures/grass-normal.png": "blob:grass-normal",
      "assets/textures/grass-orm.png": "blob:grass-orm"
    };
    assetResolver.sync(contentLibrary, fileSources);
    const shaderRuntime = new ShaderRuntime({
      contentLibrary,
      compileProfile: "authoring-preview",
      assetResolver
    });
    const evaluateSurfaceBindingSpy = vi.spyOn(shaderRuntime, "evaluateMeshSurfaceBinding");
    const controller = createLandscapeSceneController(
      scene,
      assetResolver,
      () => shaderRuntime
    );
    const region = makeRegion(true);

    region.landscape.channels.push({
      channelId: "landscape-channel:grass",
      displayName: "Grass",
      mode: "material",
      color: 0x5c8a5a,
      materialDefinitionId: "wordlark:material:grass",
      tilingScale: null
    });

    const result = controller.apply(region, contentLibrary, fileSources);

    expect(result.descriptor?.enabled).toBe(true);
    expect(evaluateSurfaceBindingSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSurfaceBindingSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        shaderDefinitionId: "wordlark:shader:standard-pbr"
      })
    );
    const landscapeMesh = controller.root.children[0] as THREE.Mesh | undefined;
    expect(landscapeMesh).toBeTruthy();

    const material = landscapeMesh?.material as THREE.Material & {
      colorNode?: unknown;
      normalNode?: unknown;
      roughnessNode?: unknown;
      metalnessNode?: unknown;
      aoNode?: unknown;
    };
    expect(material.colorNode).toBeTruthy();
    expect(material.normalNode).toBeTruthy();
    expect(material.roughnessNode).toBeTruthy();
    expect(material.metalnessNode).toBeTruthy();
    expect(material.aoNode).toBeTruthy();

    shaderRuntime.dispose();
    controller.dispose();
  });

  it("defaults tilingScale to null on freshly-created channels", async () => {
    const { createRegionLandscapeChannelDefinition } = await import(
      "@sugarmagic/domain"
    );
    const channel = createRegionLandscapeChannelDefinition({
      displayName: "Brick",
      mode: "material",
      materialDefinitionId: "wordlark:material:brick"
    });
    expect(channel.tilingScale).toBeNull();
  });

  it("preserves explicit tilingScale passed to the factory", async () => {
    const { createRegionLandscapeChannelDefinition } = await import(
      "@sugarmagic/domain"
    );
    const channel = createRegionLandscapeChannelDefinition({
      mode: "material",
      materialDefinitionId: "wordlark:material:brick",
      tilingScale: [8, 4]
    });
    expect(channel.tilingScale).toEqual([8, 4]);
  });

  it("normalizes legacy persisted channels missing tilingScale", async () => {
    const { normalizeRegionDocumentForLoad, createEmptyContentLibrarySnapshot } =
      await import("@sugarmagic/domain");
    const contentLibrary = createEmptyContentLibrarySnapshot("wordlark");
    const legacyRegion = {
      identity: { id: "region-legacy", schema: "RegionDocument", version: 1 },
      displayName: "Legacy",
      placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
      scene: {
        folders: [],
        playerPresence: null,
        npcPresences: [],
        itemPresences: [],
        placedAssets: []
      },
      environmentBinding: { defaultEnvironmentId: null },
      areas: [],
      behaviors: [],
      markers: [],
      gameplayPlacements: [],
      landscape: {
        enabled: true,
        size: 64,
        subdivisions: 64,
        paintPayload: null,
        channels: [
          {
            channelId: "landscape-legacy-channel",
            displayName: "Dirt",
            mode: "material",
            color: 0x7a2018,
            materialDefinitionId: "wordlark:material:dirt"
            // NOTE: no tilingScale — simulates a saved-project shape
            // from before this field existed.
          }
        ]
      }
    } as never;
    const normalized = normalizeRegionDocumentForLoad(legacyRegion, contentLibrary);
    const channel = normalized.landscape.channels.find(
      (c) => c.channelId === "landscape-legacy-channel"
    );
    expect(channel).toBeTruthy();
    expect(channel?.tilingScale).toBeNull();
  });
});
