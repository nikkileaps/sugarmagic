/**
 * Material resolution tests.
 *
 * Verifies runtime-core's single material-binding enforcer: material-bound
 * slots resolve through the shared MaterialDefinition snapshot, inline
 * parameter overrides can still tweak values, and inline shader swaps do not
 * replace a bound material's parent shader.
 */

import { describe, expect, it } from "vitest";
import type { AssetDefinition, ContentLibrarySnapshot, PlacedAssetInstance } from "@sugarmagic/domain";
import {
  createDefaultStandardPbrShaderGraph,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import {
  resolveAssetDefinitionShaderBindings,
  resolveEffectiveAssetMaterialSlotBindings
} from "@sugarmagic/runtime-core";

function makeContentLibrary(): ContentLibrarySnapshot {
  const snapshot = createEmptyContentLibrarySnapshot("wordlark");
  const standardPbr = createDefaultStandardPbrShaderGraph("wordlark");

  return {
    ...snapshot,
    shaderDefinitions: [standardPbr],
    textureDefinitions: [
      {
        definitionId: "wordlark:texture:brick-base",
        definitionKind: "texture",
        displayName: "Brick Base",
        source: {
          relativeAssetPath: "assets/textures/brick-base.png",
          fileName: "brick-base.png",
          mimeType: "image/png"
        },
        colorSpace: "srgb",
        packing: "rgba"
      },
      {
        definitionId: "wordlark:texture:brick-normal",
        definitionKind: "texture",
        displayName: "Brick Normal",
        source: {
          relativeAssetPath: "assets/textures/brick-normal.png",
          fileName: "brick-normal.png",
          mimeType: "image/png"
        },
        colorSpace: "linear",
        packing: "normal"
      },
      {
        definitionId: "wordlark:texture:brick-orm",
        definitionKind: "texture",
        displayName: "Brick ORM",
        source: {
          relativeAssetPath: "assets/textures/brick-orm.png",
          fileName: "brick-orm.png",
          mimeType: "image/png"
        },
        colorSpace: "linear",
        packing: "orm"
      }
    ],
    materialDefinitions: [
      {
        definitionId: "wordlark:material:brick",
        definitionKind: "material",
        displayName: "Brick",
        shaderDefinitionId: standardPbr.shaderDefinitionId,
        parameterValues: {
          tiling: [3, 4],
          roughness_scale: 0.6
        },
        textureBindings: {
          basecolor_texture: "wordlark:texture:brick-base",
          normal_texture: "wordlark:texture:brick-normal",
          orm_texture: "wordlark:texture:brick-orm"
        }
      }
    ]
  };
}

function makeAssetDefinition(): AssetDefinition {
  return {
    definitionId: "wordlark:asset:house",
    definitionKind: "asset",
    displayName: "House",
    assetKind: "model",
    materialSlotBindings: [
      {
        slotName: "Wall",
        slotIndex: 0,
        materialDefinitionId: "wordlark:material:brick"
      }
    ],
    defaultShaderBindings: {
      surface: null,
      deform: null
    },
    defaultShaderParameterOverrides: [],
    source: {
      relativeAssetPath: "assets/imported/house.glb",
      fileName: "house.glb",
      mimeType: "model/gltf-binary"
    }
  };
}

function makePlacedAsset(): PlacedAssetInstance {
  return {
    instanceId: "placed-asset:house-1",
    assetDefinitionId: "wordlark:asset:house",
    displayName: "House 1",
    parentFolderId: null,
    inspectable: null,
    shaderOverrides: [
      {
        slot: "surface",
        shaderDefinitionId: "wordlark:shader:should-be-ignored"
      }
    ],
    shaderParameterOverrides: [
      {
        slot: "surface",
        parameterId: "tiling",
        value: [6, 2]
      }
    ],
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    }
  };
}

describe("material resolution", () => {
  it("resolves asset-level material slot bindings through the bound material snapshot", () => {
    const contentLibrary = makeContentLibrary();
    const assetDefinition = makeAssetDefinition();

    const result = resolveAssetDefinitionShaderBindings(assetDefinition, contentLibrary);

    expect(result.materialSlots).toHaveLength(1);
    expect(result.materialSlots[0]?.slotName).toBe("Wall");
    expect(result.materialSlots[0]?.surface?.shaderDefinitionId).toBe(
      "wordlark:shader:standard-pbr"
    );
    expect(result.materialSlots[0]?.surface?.parameterValues.tiling).toEqual([3, 4]);
    expect(result.materialSlots[0]?.surface?.textureBindings).toEqual({
      basecolor_texture: "wordlark:texture:brick-base",
      normal_texture: "wordlark:texture:brick-normal",
      orm_texture: "wordlark:texture:brick-orm"
    });
  });

  it("lets inline parameter overrides adjust a material-bound slot without replacing its shader", () => {
    const contentLibrary = {
      ...makeContentLibrary(),
      assetDefinitions: [makeAssetDefinition()]
    };
    const placedAsset = makePlacedAsset();

    const result = resolveEffectiveAssetMaterialSlotBindings(placedAsset, contentLibrary);

    expect(result[0]?.surface?.shaderDefinitionId).toBe("wordlark:shader:standard-pbr");
    expect(result[0]?.surface?.parameterValues.tiling).toEqual([6, 2]);
  });
});
