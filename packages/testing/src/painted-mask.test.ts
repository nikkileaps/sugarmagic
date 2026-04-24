import { describe, expect, it } from "vitest";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createDefaultRegion,
  createDefaultSurfaceDefinition,
  createEmptyContentLibrarySnapshot,
  createInlineSurfaceBinding,
  createSurface,
  normalizeContentLibrarySnapshot
} from "@sugarmagic/domain";
import { reconcilePaintedMaskDefinitionsForSave } from "@sugarmagic/io";

function createPaintedInlineSurface(maskTextureId: string) {
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
  );
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

    const reconciled = reconcilePaintedMaskDefinitionsForSave(contentLibrary, [region]);

    expect(
      (reconciled.contentLibrary.maskTextureDefinitions ?? []).map(
        (definition) => definition.definitionId
      )
    ).toEqual(["little-world:mask-texture:kept"]);
    expect(reconciled.orphanedMaskPaths).toEqual(["masks/orphaned.png"]);
  });
});
