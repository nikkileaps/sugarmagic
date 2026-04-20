import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ContentLibrarySnapshot, RegionDocument } from "@sugarmagic/domain";
import {
  createDefaultRegionLandscapeState,
  createDefaultStandardPbrShaderGraph,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import { resolveMaterialEffectiveShaderBinding } from "@sugarmagic/runtime-core";
import {
  createAuthoredAssetResolver,
  createLandscapeSceneController,
  ShaderRuntime
} from "@sugarmagic/render-web";

function makeRegion(): RegionDocument {
  return {
    identity: { id: "region-landscape-parity", schema: "RegionDocument", version: 1 },
    displayName: "Landscape Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: { folders: [], placedAssets: [], playerPresence: null, npcPresences: [], itemPresences: [] },
    environmentBinding: { defaultEnvironmentId: null },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: true }),
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

describe("landscape standard pbr parity", () => {
  it("routes single-channel material-mode landscape through ShaderRuntime.evaluateMeshSurfaceBinding", () => {
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
    const directBinding = resolveMaterialEffectiveShaderBinding(
      contentLibrary,
      "wordlark:material:grass"
    );
    expect(directBinding).toBeTruthy();

    const directNodeSet = shaderRuntime.evaluateMeshSurfaceBinding(directBinding!, {
      geometry: new THREE.PlaneGeometry(16, 16, 4, 4),
      carrierMaterial: new THREE.MeshStandardMaterial()
    });
    expect(directNodeSet?.colorNode).toBeTruthy();
    expect(directNodeSet?.normalNode).toBeTruthy();
    expect(directNodeSet?.roughnessNode).toBeTruthy();
    expect(directNodeSet?.metalnessNode).toBeTruthy();
    expect(directNodeSet?.aoNode).toBeTruthy();

    const evaluateSurfaceBindingSpy = vi.spyOn(shaderRuntime, "evaluateMeshSurfaceBinding");
    const scene = new THREE.Scene();
    const controller = createLandscapeSceneController(
      scene,
      assetResolver,
      () => shaderRuntime
    );
    const region = makeRegion();
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
        shaderDefinitionId: directBinding?.shaderDefinitionId,
        textureBindings: directBinding?.textureBindings,
        parameterValues: directBinding?.parameterValues
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
});
