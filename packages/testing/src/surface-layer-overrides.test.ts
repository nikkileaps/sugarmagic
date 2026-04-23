/**
 * Surface-layer override tests.
 *
 * Verifies runtime-core's single reference-surface enforcer: bounded override
 * payloads can tune a referenced layer's presentation/content without
 * mutating identity, scatter density multipliers apply deterministically, and
 * orphaned override keys surface explicit diagnostics.
 */

import { describe, expect, it } from "vitest";
import type { ContentLibrarySnapshot } from "@sugarmagic/domain";
import {
  createAppearanceLayer,
  createDefaultGrassTypeDefinition,
  createDefaultStandardPbrShaderGraph,
  createEmptyContentLibrarySnapshot,
  createMaterialAppearanceContent,
  createReferenceSurfaceBinding,
  createScatterLayer,
  createSurface
} from "@sugarmagic/domain";
import { resolveSurfaceBinding } from "@sugarmagic/runtime-core";

function createContentLibrary(): ContentLibrarySnapshot {
  const snapshot = createEmptyContentLibrarySnapshot("little-world");
  const standardPbr = createDefaultStandardPbrShaderGraph("little-world");
  const grassType = createDefaultGrassTypeDefinition("little-world", {
    definitionId: "little-world:grass-type:meadow",
    displayName: "Meadow Grass",
    density: 12
  });

  return {
    ...snapshot,
    shaderDefinitions: [standardPbr],
    textureDefinitions: [
      {
        definitionId: "little-world:texture:grass-a",
        definitionKind: "texture",
        displayName: "Grass A",
        source: {
          relativeAssetPath: "assets/textures/grass-a.png",
          fileName: "grass-a.png",
          mimeType: "image/png"
        },
        colorSpace: "srgb",
        packing: "rgba"
      },
      {
        definitionId: "little-world:texture:grass-b",
        definitionKind: "texture",
        displayName: "Grass B",
        source: {
          relativeAssetPath: "assets/textures/grass-b.png",
          fileName: "grass-b.png",
          mimeType: "image/png"
        },
        colorSpace: "srgb",
        packing: "rgba"
      }
    ],
    maskTextureDefinitions: [
      {
        definitionId: "little-world:mask-texture:painted",
        definitionKind: "mask-texture",
        displayName: "Painted Flowers",
        source: {
          relativeAssetPath: "masks/painted-flowers.png",
          fileName: "painted-flowers.png",
          mimeType: "image/png"
        },
        format: "r8",
        resolution: [256, 256]
      }
    ],
    materialDefinitions: [
      {
        definitionId: "little-world:material:meadow-base",
        definitionKind: "material",
        displayName: "Meadow Base",
        shaderDefinitionId: standardPbr.shaderDefinitionId,
        parameterValues: {
          roughness_scale: 0.2,
          tiling: [2, 2]
        },
        textureBindings: {
          basecolor_texture: "little-world:texture:grass-a"
        }
      }
    ],
    grassTypeDefinitions: [grassType],
    surfaceDefinitions: [
      {
        definitionId: "little-world:surface:wildflower",
        definitionKind: "surface",
        displayName: "Wildflower Meadow",
        surface: createSurface([
          createAppearanceLayer(
            createMaterialAppearanceContent("little-world:material:meadow-base"),
            {
              layerId: "base-layer",
              displayName: "Base",
              blendMode: "base"
            }
          ),
          createScatterLayer(
            {
              kind: "grass",
              grassTypeId: grassType.definitionId
            },
            {
              layerId: "grass-layer",
              displayName: "Grass"
            }
          )
        ])
      }
    ]
  };
}

describe("resolveSurfaceBinding", () => {
  it("applies bounded reference-layer overrides to appearance and scatter layers", () => {
    const contentLibrary = createContentLibrary();
    const binding = createReferenceSurfaceBinding(
      "little-world:surface:wildflower"
    );

    if (binding.kind !== "reference") {
      throw new Error("Expected a reference surface binding.");
    }

    binding.layerOverrides = {
      "base-layer": {
        layerId: "base-layer",
        targetKind: "appearance",
        enabled: true,
        opacity: 0.6,
        mask: {
          kind: "painted",
          maskTextureId: "little-world:mask-texture:painted"
        },
        blendMode: "overlay",
        contentTuning: {
          for: "material",
          parameterOverrides: {
            roughness_scale: 0.85
          },
          textureBindingOverrides: {
            basecolor_texture: "little-world:texture:grass-b"
          }
        }
      },
      "grass-layer": {
        layerId: "grass-layer",
        targetKind: "scatter",
        densityMultiplier: 1.5
      },
      "missing-layer": {
        layerId: "missing-layer",
        targetKind: "scatter",
        densityMultiplier: 2
      }
    };

    const result = resolveSurfaceBinding(
      binding,
      contentLibrary,
      "universal"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const appearanceLayer = result.binding.layers.find(
      (layer) => layer.kind === "appearance"
    );
    const scatterLayer = result.binding.layers.find(
      (layer) => layer.kind === "scatter"
    );

    expect(appearanceLayer).toMatchObject({
      kind: "appearance",
      opacity: 0.6,
      blendMode: "overlay",
      mask: {
        kind: "painted",
        maskTextureId: "little-world:mask-texture:painted"
      }
    });
    expect(appearanceLayer?.binding.parameterValues.roughness_scale).toBe(0.85);
    expect(appearanceLayer?.binding.textureBindings.basecolor_texture).toBe(
      "little-world:texture:grass-b"
    );

    expect(scatterLayer).toMatchObject({
      kind: "scatter",
      density: 18
    });
    expect(result.binding.diagnostics).toContainEqual({
      severity: "warning",
      expectedTargetKind: "mesh-surface",
      shaderDefinitionId: null,
      message:
        'SurfaceBinding layerOverrides references missing layer "missing-layer".'
    });
  });

  it("surfaces kind drift in override payloads as diagnostics instead of mutating content illegally", () => {
    const contentLibrary = createContentLibrary();
    const binding = createReferenceSurfaceBinding(
      "little-world:surface:wildflower"
    );

    if (binding.kind !== "reference") {
      throw new Error("Expected a reference surface binding.");
    }

    binding.layerOverrides = {
      "base-layer": {
        layerId: "base-layer",
        targetKind: "scatter",
        densityMultiplier: 3
      }
    };

    const result = resolveSurfaceBinding(
      binding,
      contentLibrary,
      "universal"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const appearanceLayer = result.binding.layers.find(
      (layer) => layer.kind === "appearance"
    );

    expect(appearanceLayer?.opacity).toBe(1);
    expect(appearanceLayer?.blendMode).toBe("base");
    expect(result.binding.diagnostics).toContainEqual({
      severity: "warning",
      expectedTargetKind: "mesh-surface",
      shaderDefinitionId: null,
      message:
        'LayerOverride kind "scatter" no longer matches layer "base-layer" kind "appearance".'
    });
  });
});
