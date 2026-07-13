import { describe, expect, it } from "vitest";
import type { MaskTextureDefinition, SurfaceBinding } from "@sugarmagic/domain";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createDefaultRegion,
  createDefaultScene,
  createDefaultSurfaceDefinition,
  createEmptyContentLibrarySnapshot,
  createInlineSurfaceBinding,
  createPlacedAssetInstance,
  createRegionSceneOverlay,
  createSurface,
  normalizeContentLibrarySnapshot
} from "@sugarmagic/domain";
import { reconcilePaintedMaskDefinitionsForSave } from "@sugarmagic/io";

function createPaintedInlineSurface(maskTextureId: string): SurfaceBinding<"universal"> {
  return createInlineSurfaceBinding(
    createSurface([
      createAppearanceLayer(createColorAppearanceContent(0x88aa66), {
        displayName: "Ground",
        blendMode: "base",
        mask: {
          kind: "painted",
          maskTextureId
        }
      })
    ])
  ) as SurfaceBinding<"universal">;
}

describe("painted masks", () => {
  it("rejects painted masks on reusable SurfaceDefinitions during normalization", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const badSurfaceDefinition = createDefaultSurfaceDefinition("little-world", {
      definitionId: "little-world:surface:bad-painted",
      displayName: "Bad Painted Surface"
    });

    badSurfaceDefinition.surface = createSurface([
      createAppearanceLayer(createColorAppearanceContent(0x88aa66), {
        displayName: "Ground",
        blendMode: "base",
        mask: {
          kind: "painted",
          maskTextureId: "little-world:mask-texture:painted"
        }
      })
    ]);
    (contentLibrary.surfaceDefinitions ??= []).push(badSurfaceDefinition);

    expect(() => normalizeContentLibrarySnapshot(contentLibrary, "little-world")).toThrow(
      /only valid on inline application-site surfaces/i
    );
  });

  it("reconciles orphaned painted mask definitions on save", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    contentLibrary.maskTextureDefinitions = [
      {
        definitionId: "little-world:mask-texture:kept",
        definitionKind: "mask-texture",
        displayName: "Kept",
        source: {
          relativeAssetPath: "masks/kept.png",
          fileName: "kept.png",
          mimeType: "image/png"
        },
        format: "r8",
        resolution: [512, 512]
      },
      {
        definitionId: "little-world:mask-texture:orphaned",
        definitionKind: "mask-texture",
        displayName: "Orphaned",
        source: {
          relativeAssetPath: "masks/orphaned.png",
          fileName: "orphaned.png",
          mimeType: "image/png"
        },
        format: "r8",
        resolution: [512, 512]
      }
    ];

    const region = createDefaultRegion({
      regionId: "glade",
      displayName: "Glade"
    });
    region.landscape.surfaceSlots[0] = {
      ...region.landscape.surfaceSlots[0],
      surface: createPaintedInlineSurface("little-world:mask-texture:kept")
    };

    const reconciled = reconcilePaintedMaskDefinitionsForSave(
      contentLibrary,
      [region],
      []
    );

    expect(
      (reconciled.contentLibrary.maskTextureDefinitions ?? []).map(
        (definition) => definition.definitionId
      )
    ).toEqual(["little-world:mask-texture:kept"]);
    expect(reconciled.orphanedMaskPaths).toEqual(["masks/orphaned.png"]);
  });

  it("keeps masks referenced ONLY by instance overrides and Scene records (Plan 068)", () => {
    // Regression: pre-068 the save sweep scanned only definition
    // slots + landscape, so a mask painted on an instance override
    // was DELETED (definition + png) at the next save.
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const maskDefinition = (suffix: string): MaskTextureDefinition => ({
      definitionId: `little-world:mask-texture:${suffix}`,
      definitionKind: "mask-texture",
      displayName: suffix,
      source: {
        relativeAssetPath: `masks/${suffix}.png`,
        fileName: `${suffix}.png`,
        mimeType: "image/png"
      },
      format: "r8",
      resolution: [512, 512]
    });
    contentLibrary.maskTextureDefinitions = [
      maskDefinition("base-instance"),
      maskDefinition("scene-instance"),
      maskDefinition("scene-record")
    ];

    const region = createDefaultRegion({
      regionId: "glade",
      displayName: "Glade"
    });
    region.placedAssets.push(
      createPlacedAssetInstance({
        assetDefinitionId: "asset:outcrop",
        surfaceSlotOverrides: [
          {
            slotName: "stone",
            surface: createPaintedInlineSurface(
              "little-world:mask-texture:base-instance"
            )
          }
        ]
      })
    );

    const scene = createDefaultScene({
      sceneId: "scene:snowy",
      regionOverlays: {
        glade: createRegionSceneOverlay({
          placedAssets: [
            createPlacedAssetInstance({
              assetDefinitionId: "asset:bench",
              surfaceSlotOverrides: [
                {
                  slotName: "wood",
                  surface: createPaintedInlineSurface(
                    "little-world:mask-texture:scene-instance"
                  )
                }
              ]
            })
          ],
          assetAppearanceOverrides: {
            "some-base-instance": {
              surfaceSlotOverrides: [
                {
                  slotName: "roof",
                  surface: createPaintedInlineSurface(
                    "little-world:mask-texture:scene-record"
                  )
                }
              ]
            }
          }
        })
      }
    });

    const reconciled = reconcilePaintedMaskDefinitionsForSave(
      contentLibrary,
      [region],
      [scene]
    );

    expect(
      (reconciled.contentLibrary.maskTextureDefinitions ?? [])
        .map((definition) => definition.definitionId)
        .sort()
    ).toEqual([
      "little-world:mask-texture:base-instance",
      "little-world:mask-texture:scene-instance",
      "little-world:mask-texture:scene-record"
    ]);
    expect(reconciled.orphanedMaskPaths).toEqual([]);
  });
});
