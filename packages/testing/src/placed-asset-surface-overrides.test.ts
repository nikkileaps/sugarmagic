/**
 * Per-slot instance surface override tests (Plan 068.1).
 *
 * Covers the command (upsert / clear across base and Scene overlay
 * stores) and the resolution precedence: instance slot override >
 * definition slot surface — no tier below that. Unassigned slots
 * stay null (imported model material) and broken references resolve
 * to the loud magenta error surface.
 */

import { describe, expect, it } from "vitest";
import type {
  PlacedAssetInstance,
  RegionDocument,
  Scene,
  SemanticCommand,
  SurfaceBinding
} from "@sugarmagic/domain";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createDefaultRegionLandscapeState,
  createDefaultScene,
  createEmptyContentLibrarySnapshot,
  createInlineSurfaceBinding,
  createSurface,
  executeCommand
} from "@sugarmagic/domain";
import { resolveEffectiveAssetMaterialSlotBindings } from "@sugarmagic/runtime-core";

function colorSurface(color: number): SurfaceBinding<"universal"> {
  return createInlineSurfaceBinding(
    createSurface([
      createAppearanceLayer(createColorAppearanceContent(color), {
        displayName: "Fill",
        blendMode: "base"
      })
    ])
  ) as SurfaceBinding<"universal">;
}

function makeInstance(
  overrides: Partial<PlacedAssetInstance> = {}
): PlacedAssetInstance {
  return {
    instanceId: "instance-001",
    assetDefinitionId: "asset:house",
    displayName: "House",
    parentFolderId: null,
    inspectable: null,
    shaderParameterOverrides: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...overrides
  };
}

function makeRegion(assets: PlacedAssetInstance[]): RegionDocument {
  return {
    identity: { id: "test-region", schema: "RegionDocument", version: 1 },
    displayName: "Test Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: assets,
    folders: [],
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  } as unknown as RegionDocument;
}

function overrideCommand(
  slotName: string,
  surface: SurfaceBinding<"universal"> | null,
  instanceId = "instance-001"
): SemanticCommand {
  return {
    kind: "SetPlacedAssetSurfaceSlotOverride",
    target: { aggregateKind: "region-document", aggregateId: "test-region" },
    subject: { subjectKind: "placed-asset", subjectId: instanceId },
    payload: { instanceId, slotName, surface }
  };
}

describe("SetPlacedAssetSurfaceSlotOverride command", () => {
  it("upserts an override for one slot and leaves other slots alone", () => {
    const region = makeRegion([
      makeInstance({
        surfaceSlotOverrides: [{ slotName: "walls", surface: colorSurface(0x112233) }]
      })
    ]);
    const scene: Scene = createDefaultScene({ sceneId: "scene:test" });

    const result = executeCommand(
      { region, scene },
      overrideCommand("roof", colorSurface(0x445566))
    );

    const asset = result.region.placedAssets[0]!;
    expect(asset.surfaceSlotOverrides).toHaveLength(2);
    expect(asset.surfaceSlotOverrides!.map((o) => o.slotName).sort()).toEqual([
      "roof",
      "walls"
    ]);
  });

  it("replaces an existing override for the same slot instead of stacking", () => {
    const region = makeRegion([
      makeInstance({
        surfaceSlotOverrides: [{ slotName: "roof", surface: colorSurface(0x111111) }]
      })
    ]);
    const scene: Scene = createDefaultScene({ sceneId: "scene:test" });

    const result = executeCommand(
      { region, scene },
      overrideCommand("roof", colorSurface(0x222222))
    );

    const asset = result.region.placedAssets[0]!;
    expect(asset.surfaceSlotOverrides).toHaveLength(1);
    const surface = asset.surfaceSlotOverrides![0]!.surface;
    expect(surface.kind).toBe("inline");
  });

  it("clears an override with surface: null and drops the field when empty", () => {
    const region = makeRegion([
      makeInstance({
        surfaceSlotOverrides: [{ slotName: "roof", surface: colorSurface(0x111111) }]
      })
    ]);
    const scene: Scene = createDefaultScene({ sceneId: "scene:test" });

    const result = executeCommand({ region, scene }, overrideCommand("roof", null));

    expect(result.region.placedAssets[0]!.surfaceSlotOverrides).toBeUndefined();
  });

  it("reaches instances living in the active Scene overlay", () => {
    const region = makeRegion([]);
    const base = createDefaultScene({ sceneId: "scene:test" });
    const scene: Scene = {
      ...base,
      regionOverlays: {
        "test-region": {
          itemPresences: [],
          npcPresences: [],
          playerPresence: null,
          placedAssets: [makeInstance({ instanceId: "overlay-001" })],
          folders: []
        }
      }
    };

    const result = executeCommand(
      { region, scene },
      overrideCommand("roof", colorSurface(0x334455), "overlay-001")
    );

    const overlayAsset =
      result.scene.regionOverlays["test-region"]!.placedAssets[0]!;
    expect(overlayAsset.surfaceSlotOverrides).toHaveLength(1);
    expect(overlayAsset.surfaceSlotOverrides![0]!.slotName).toBe("roof");
  });
});

describe("per-slot override resolution", () => {
  function makeLibraryWithHouse() {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    contentLibrary.assetDefinitions.push({
      definitionId: "asset:house",
      definitionKind: "asset",
      displayName: "House",
      assetKind: "model",
      surfaceSlots: [
        { slotName: "walls", slotIndex: 0, surface: colorSurface(0xaaaaaa) },
        { slotName: "roof", slotIndex: 1, surface: colorSurface(0xbbbbbb) }
      ],
      deform: null,
      effect: null,
      source: {
        relativeAssetPath: "assets/house.glb",
        fileName: "house.glb",
        mimeType: "model/gltf-binary"
      }
    });
    return contentLibrary;
  }

  it("an instance slot override beats the definition's slot surface; other slots fall through", () => {
    const contentLibrary = makeLibraryWithHouse();
    const mossyRoof = colorSurface(0x225522);
    const instance = makeInstance({
      surfaceSlotOverrides: [{ slotName: "roof", surface: mossyRoof }]
    });

    const slots = resolveEffectiveAssetMaterialSlotBindings(
      instance,
      contentLibrary
    );
    const plain = resolveEffectiveAssetMaterialSlotBindings(
      makeInstance(),
      contentLibrary
    );

    expect(slots).toHaveLength(2);
    // The overridden slot resolves to a DIFFERENT surface stack than
    // the definition default; the untouched slot resolves identically.
    const roof = slots.find((slot) => slot.slotName === "roof")!;
    const plainRoof = plain.find((slot) => slot.slotName === "roof")!;
    expect(JSON.stringify(roof.surface)).not.toEqual(
      JSON.stringify(plainRoof.surface)
    );
    const walls = slots.find((slot) => slot.slotName === "walls")!;
    const plainWalls = plain.find((slot) => slot.slotName === "walls")!;
    expect(JSON.stringify(walls.surface)).toEqual(
      JSON.stringify(plainWalls.surface)
    );
  });

  it("an unassigned slot resolves to null (imported model material), never a fallback", () => {
    const contentLibrary = makeLibraryWithHouse();
    contentLibrary.assetDefinitions[0]!.surfaceSlots.push({
      slotName: "trim",
      slotIndex: 2,
      surface: null
    });
    // Even with a legacy whole-owner surface override present, the
    // empty slot stays null -- the old silent fallback tier that
    // painted unassigned slots with it was deleted (2026-07-12).
    const instance = makeInstance({
      shaderOverrides: [
        { slot: "surface", shaderDefinitionId: "shader:legacy-whatever" }
      ]
    });

    const slots = resolveEffectiveAssetMaterialSlotBindings(
      instance,
      contentLibrary
    );
    const trim = slots.find((slot) => slot.slotName === "trim")!;
    expect(trim.surface).toBeNull();
  });

  it("a BROKEN surface reference resolves to the loud magenta error surface, not silence", () => {
    const contentLibrary = makeLibraryWithHouse();
    const instance = makeInstance({
      surfaceSlotOverrides: [
        {
          slotName: "roof",
          surface: { kind: "reference", surfaceDefinitionId: "surface:deleted" }
        }
      ]
    });

    const slots = resolveEffectiveAssetMaterialSlotBindings(
      instance,
      contentLibrary
    );
    const roof = slots.find((slot) => slot.slotName === "roof")!;
    expect(roof.surface).not.toBeNull();
    // The error magenta 0xff00ff resolves to normalized [1, 0, 1].
    const serialized = JSON.stringify(roof.surface);
    expect(serialized).toContain("Broken surface reference");
    expect(serialized).toContain('"color":[1,0,1]');
  });

  it("an override for an unknown slot name is ignored (no phantom slots)", () => {
    const contentLibrary = makeLibraryWithHouse();
    const instance = makeInstance({
      surfaceSlotOverrides: [
        { slotName: "no-such-slot", surface: colorSurface(0x123456) }
      ]
    });

    const slots = resolveEffectiveAssetMaterialSlotBindings(
      instance,
      contentLibrary
    );
    expect(slots.map((slot) => slot.slotName).sort()).toEqual([
      "roof",
      "walls"
    ]);
  });
});
