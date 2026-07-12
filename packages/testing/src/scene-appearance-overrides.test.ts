/**
 * Scene-scoped appearance override tests (Plan 068.2).
 *
 * A Scene can restyle a BASE placement without forking it: scope
 * "scene" writes land in the active Scene's overlay record, and
 * resolution applies scene > instance > definition. Scene-contained
 * instances route scene-scope writes to their own fields instead
 * (containment already scene-scopes them -- the double-scoping
 * guard).
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
  createRegionSceneOverlay,
  createSurface,
  executeCommand
} from "@sugarmagic/domain";
import { mergeAppearanceOverrideTiers } from "@sugarmagic/domain";
import {
  resolveEffectiveAssetMaterialSlotBindings,
  resolveSceneObjects
} from "@sugarmagic/runtime-core";

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

function sceneScopedSurfaceCommand(
  slotName: string,
  surface: SurfaceBinding<"universal"> | null,
  instanceId = "instance-001"
): SemanticCommand {
  return {
    kind: "SetPlacedAssetSurfaceSlotOverride",
    target: { aggregateKind: "region-document", aggregateId: "test-region" },
    subject: { subjectKind: "placed-asset", subjectId: instanceId },
    payload: { instanceId, slotName, surface, scope: "scene" }
  };
}

describe("scene-scoped appearance commands", () => {
  it("a scene-scope write on a BASE placement lands in the overlay record, not the instance", () => {
    const region = makeRegion([makeInstance()]);
    const scene = createDefaultScene({ sceneId: "scene:snowy" });

    const result = executeCommand(
      { region, scene },
      sceneScopedSurfaceCommand("roof", colorSurface(0xffffff))
    );

    // Instance untouched.
    expect(result.region.placedAssets[0]!.surfaceSlotOverrides).toBeUndefined();
    // Overlay record written (overlay created on demand).
    const record =
      result.scene.regionOverlays["test-region"]!.assetAppearanceOverrides[
        "instance-001"
      ]!;
    expect(record.surfaceSlotOverrides).toHaveLength(1);
    expect(record.surfaceSlotOverrides![0]!.slotName).toBe("roof");
  });

  it("clearing the last scene override drops the whole record", () => {
    const region = makeRegion([makeInstance()]);
    const scene = createDefaultScene({ sceneId: "scene:snowy" });

    const applied = executeCommand(
      { region, scene },
      sceneScopedSurfaceCommand("roof", colorSurface(0xffffff))
    );
    const cleared = executeCommand(
      { region: applied.region, scene: applied.scene },
      sceneScopedSurfaceCommand("roof", null)
    );

    expect(
      cleared.scene.regionOverlays["test-region"]!.assetAppearanceOverrides[
        "instance-001"
      ]
    ).toBeUndefined();
  });

  it("a scene-scope write on a SCENE-CONTAINED instance routes to the instance (double-scoping guard)", () => {
    const region = makeRegion([]);
    const base = createDefaultScene({ sceneId: "scene:snowy" });
    const scene: Scene = {
      ...base,
      regionOverlays: {
        "test-region": createRegionSceneOverlay({
          placedAssets: [makeInstance({ instanceId: "overlay-001" })]
        })
      }
    };

    const result = executeCommand(
      { region, scene },
      sceneScopedSurfaceCommand("roof", colorSurface(0x00ff00), "overlay-001")
    );

    const overlay = result.scene.regionOverlays["test-region"]!;
    // Fields on the instance, NO appearance record.
    expect(overlay.placedAssets[0]!.surfaceSlotOverrides).toHaveLength(1);
    expect(overlay.assetAppearanceOverrides["overlay-001"]).toBeUndefined();
  });

  it("scene-scoped deform/effect shader overrides land in the record too", () => {
    const region = makeRegion([makeInstance()]);
    const scene = createDefaultScene({ sceneId: "scene:snowy" });

    const result = executeCommand(
      { region, scene },
      {
        kind: "SetPlacedAssetShaderOverride",
        target: { aggregateKind: "region-document", aggregateId: "test-region" },
        subject: { subjectKind: "placed-asset", subjectId: "instance-001" },
        payload: {
          instanceId: "instance-001",
          slot: "deform",
          shaderDefinitionId: "shader:wind",
          scope: "scene"
        }
      }
    );

    const record =
      result.scene.regionOverlays["test-region"]!.assetAppearanceOverrides[
        "instance-001"
      ]!;
    expect(record.shaderOverrides).toEqual([
      { slot: "deform", shaderDefinitionId: "shader:wind" }
    ]);
    expect(result.region.placedAssets[0]!.shaderOverrides).toBeUndefined();
  });
});

describe("mergeAppearanceOverrideTiers", () => {
  it("tags each merged entry with the tier that supplied it (scene wins per slot)", () => {
    const instance = makeInstance({
      surfaceSlotOverrides: [
        { slotName: "roof", surface: colorSurface(0x111111) },
        { slotName: "walls", surface: colorSurface(0x222222) }
      ],
      shaderOverrides: [{ slot: "deform", shaderDefinitionId: "shader:sway" }]
    });
    const merged = mergeAppearanceOverrideTiers(instance, {
      surfaceSlotOverrides: [
        { slotName: "roof", surface: colorSurface(0x999999) }
      ],
      shaderOverrides: [{ slot: "effect", shaderDefinitionId: "shader:glow" }]
    });

    const roof = merged.surfaceSlotOverrides.find((e) => e.slotName === "roof")!;
    const walls = merged.surfaceSlotOverrides.find((e) => e.slotName === "walls")!;
    expect(roof.tier).toBe("scene");
    expect(walls.tier).toBe("base");
    expect(
      merged.shaderOverrides.find((e) => e.slot === "deform")!.tier
    ).toBe("base");
    expect(
      merged.shaderOverrides.find((e) => e.slot === "effect")!.tier
    ).toBe("scene");
  });
});

describe("scene-tier resolution", () => {
  it("scene override beats instance override; untouched slots fall to the instance tier", () => {
    const contentLibrary = makeLibraryWithHouse();
    const instance = makeInstance({
      surfaceSlotOverrides: [
        { slotName: "roof", surface: colorSurface(0x111111) },
        { slotName: "walls", surface: colorSurface(0x222222) }
      ]
    });
    const sceneOverride = {
      surfaceSlotOverrides: [
        { slotName: "roof", surface: colorSurface(0x999999) }
      ]
    };

    const withScene = resolveEffectiveAssetMaterialSlotBindings(
      instance,
      contentLibrary,
      sceneOverride
    );
    const withoutScene = resolveEffectiveAssetMaterialSlotBindings(
      instance,
      contentLibrary
    );

    const sceneRoof = withScene.find((slot) => slot.slotName === "roof")!;
    const baseRoof = withoutScene.find((slot) => slot.slotName === "roof")!;
    expect(JSON.stringify(sceneRoof.surface)).not.toEqual(
      JSON.stringify(baseRoof.surface)
    );
    // Walls untouched by the scene: identical to the instance tier.
    const sceneWalls = withScene.find((slot) => slot.slotName === "walls")!;
    const baseWalls = withoutScene.find((slot) => slot.slotName === "walls")!;
    expect(JSON.stringify(sceneWalls.surface)).toEqual(
      JSON.stringify(baseWalls.surface)
    );
  });

  it("resolveSceneObjects applies the active Scene's restyle and changes the representationKey", () => {
    const contentLibrary = makeLibraryWithHouse();
    const region = makeRegion([makeInstance()]);
    const plainScene = createDefaultScene({ sceneId: "scene:plain" });
    const snowyBase = createDefaultScene({ sceneId: "scene:snowy" });
    const snowyScene: Scene = {
      ...snowyBase,
      regionOverlays: {
        "test-region": createRegionSceneOverlay({
          assetAppearanceOverrides: {
            "instance-001": {
              surfaceSlotOverrides: [
                { slotName: "roof", surface: colorSurface(0xffffff) }
              ]
            }
          }
        })
      }
    };

    const plainObjects = resolveSceneObjects(region, {
      contentLibrary,
      activeScene: plainScene
    });
    const snowyObjects = resolveSceneObjects(region, {
      contentLibrary,
      activeScene: snowyScene
    });

    const plain = plainObjects.find((o) => o.instanceId === "instance-001")!;
    const snowy = snowyObjects.find((o) => o.instanceId === "instance-001")!;
    // Different key = the viewport rebuilds the renderable on Scene
    // switch; identical key would render the base look in the snowy
    // Scene until some unrelated change forced a reload.
    expect(snowy.representationKey).not.toEqual(plain.representationKey);
  });
});
