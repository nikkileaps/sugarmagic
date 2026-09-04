/**
 * A placed light as something the viewport can hold: which objects Studio
 * draws for it, where those objects are read from, and how a drag that moved
 * it gets written back.
 *
 * The light itself emits nothing here. This covers the handle an author grabs
 * it by, not what it lights.
 */

import { describe, expect, it } from "vitest";
import {
  resolveSceneObjects,
  type SceneObject
} from "@sugarmagic/runtime-core";
import { axisScaleBlockedBy } from "@sugarmagic/workspaces";
import {
  createDefaultRegion,
  createDefaultScene,
  createPlacedLight,
  createRegionSceneOverlay,
  executeCommand,
  type PlacedLight,
  type RegionDocument,
  type Scene,
  type SemanticCommand
} from "@sugarmagic/domain";

const REGION_ID = "region:hollow";

function regionWith(lights: PlacedLight[]): RegionDocument {
  return {
    ...createDefaultRegion({ regionId: REGION_ID, displayName: "The Hollow" }),
    placedLights: lights
  };
}

function sceneWith(lights: PlacedLight[]): Scene {
  return createDefaultScene({
    sceneId: "scene:night",
    regionId: REGION_ID,
    overlay: createRegionSceneOverlay({ placedLights: lights })
  });
}

const lantern = createPlacedLight({
  instanceId: "placed-light:lantern",
  displayName: "Lantern",
  transform: { position: [2, 1, 2], rotation: [0, 0, 0], scale: [1, 1, 1] }
});

const candle = createPlacedLight({
  instanceId: "placed-light:candle",
  displayName: "Candle"
});

describe("what Studio draws for a placed light", () => {
  it("draws nothing for a light unless asked", () => {
    const objects = resolveSceneObjects(regionWith([lantern]));

    expect(objects.some((object) => object.kind === "light")).toBe(false);
  });

  it("draws one object per light when asked", () => {
    const objects = resolveSceneObjects(regionWith([lantern]), {
      includeLights: true
    });
    const drawn = objects.filter((object) => object.kind === "light");

    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.instanceId).toBe("placed-light:lantern");
    expect(drawn[0]?.displayName).toBe("Lantern");
    expect(drawn[0]?.transform.position).toEqual([2, 1, 2]);
  });

  it("carries no model and no body, because neither is what a light is", () => {
    const [drawn] = resolveSceneObjects(regionWith([lantern]), {
      includeLights: true
    }).filter((object) => object.kind === "light");

    expect(drawn?.modelSourcePath).toBeNull();
    expect(drawn?.assetDefinitionId).toBeNull();
    expect(drawn?.capsule).toBeNull();
    expect(drawn?.collider).toBeNull();
  });

  it("changes what stands in for a light when its kind changes", () => {
    const point = resolveSceneObjects(
      regionWith([createPlacedLight({ instanceId: "l1", kind: "point" })]),
      { includeLights: true }
    ).find((object) => object.kind === "light");
    const spot = resolveSceneObjects(
      regionWith([createPlacedLight({ instanceId: "l1", kind: "spot" })]),
      { includeLights: true }
    ).find((object) => object.kind === "light");

    expect(point?.representationKey).not.toBe(spot?.representationKey);
  });

  it("draws the Scene's lights as well as the region's", () => {
    const objects = resolveSceneObjects(regionWith([lantern]), {
      includeLights: true,
      activeScene: sceneWith([candle])
    });
    const drawn = objects
      .filter((object) => object.kind === "light")
      .map((object) => object.instanceId);

    // Reading the region document instead of the composed contents would
    // leave the Scene's candle undrawable and unselectable.
    expect(drawn).toEqual(["placed-light:lantern", "placed-light:candle"]);
  });

  it("stops drawing a light the active Scene suppresses", () => {
    const scene = createDefaultScene({
      sceneId: "scene:dark",
      regionId: REGION_ID,
      overlay: createRegionSceneOverlay({
        suppressedRegionIds: [lantern.instanceId]
      })
    });
    const objects = resolveSceneObjects(regionWith([lantern]), {
      includeLights: true,
      activeScene: scene
    });

    expect(objects.some((object) => object.kind === "light")).toBe(false);
  });
});

describe("writing back a light a drag moved", () => {
  function run(
    region: RegionDocument,
    scene: Scene,
    command: SemanticCommand
  ): { region: RegionDocument; scene: Scene } {
    const result = executeCommand({ region, scene }, command);
    return { region: result.region, scene: result.scene };
  }

  const target = {
    aggregateKind: "region-document" as const,
    aggregateId: REGION_ID
  };

  it("moves a light on its own", () => {
    const region = regionWith([lantern]);
    const result = run(region, sceneWith([]), {
      kind: "TransformPlacedLight",
      target,
      subject: { subjectKind: "placed-light", subjectId: lantern.instanceId },
      payload: {
        instanceId: lantern.instanceId,
        position: [5, 0, 5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });

    expect(result.region.placedLights[0]?.transform.position).toEqual([
      5, 0, 5
    ]);
  });

  it("moves a Scene's light without touching the region's", () => {
    const region = regionWith([lantern]);
    const result = run(region, sceneWith([candle]), {
      kind: "TransformPlacedLight",
      target,
      subject: { subjectKind: "placed-light", subjectId: candle.instanceId },
      payload: {
        instanceId: candle.instanceId,
        position: [9, 0, 9],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });

    expect(result.scene.overlay.placedLights[0]?.transform.position).toEqual([
      9, 0, 9
    ]);
    expect(result.region.placedLights[0]?.transform.position).toEqual([
      2, 1, 2
    ]);
  });

  it("moves a prop and a light in one command, so one undo puts both back", () => {
    const region = {
      ...regionWith([lantern]),
      placedAssets: [
        {
          instanceId: "placed-asset:table",
          assetDefinitionId: "asset:table",
          displayName: "Table",
          parentFolderId: null,
          inspectable: null,
          shaderOverrides: [],
          shaderParameterOverrides: [],
          transform: {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number]
          }
        }
      ]
    };

    const result = executeCommand(
      { region, scene: sceneWith([]) },
      {
        kind: "TransformSceneObjects",
        target,
        subject: {
          subjectKind: "placed-asset",
          subjectId: "placed-asset:table"
        },
        payload: {
          subjects: [
            {
              subjectKind: "placed-asset",
              subjectId: "placed-asset:table",
              position: [1, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1]
            },
            {
              subjectKind: "placed-light",
              subjectId: lantern.instanceId,
              position: [3, 1, 2],
              rotation: [0, 0, 0],
              scale: [1, 1, 1]
            }
          ]
        }
      }
    );

    expect(result.region.placedAssets[0]?.transform.position).toEqual([
      1, 0, 0
    ]);
    expect(result.region.placedLights[0]?.transform.position).toEqual([
      3, 1, 2
    ]);
    // One command, so the history holds one transaction to undo.
    expect(result.transaction.command.kind).toBe("TransformSceneObjects");
  });
});

describe("whether the gizmo offers axis scale", () => {
  const rotated = {
    kind: "asset",
    transform: { rotation: [0, 0.7, 0] }
  } as unknown as SceneObject;
  const upright = {
    kind: "asset",
    transform: { rotation: [0, 0, 0] }
  } as unknown as SceneObject;
  const light = {
    kind: "light",
    transform: { rotation: [0, 0, 0] }
  } as unknown as SceneObject;

  it("offers it for upright props", () => {
    expect(axisScaleBlockedBy([upright, upright])).toBeNull();
  });

  it("withholds it from a light, which has no size to scale", () => {
    expect(axisScaleBlockedBy([light])).toBe("light-has-no-size");
  });

  it("withholds it from any selection holding a light", () => {
    expect(axisScaleBlockedBy([upright, light])).toBe("light-has-no-size");
  });

  it("still withholds it from rotated props", () => {
    expect(axisScaleBlockedBy([upright, rotated])).toBe("rotated-selection");
  });
});

describe("when Studio rebuilds a light's proxy", () => {
  function keyFor(overrides: Partial<PlacedLight>): string | undefined {
    const light = createPlacedLight({ instanceId: "l", ...overrides });
    return resolveSceneObjects(regionWith([light]), {
      includeLights: true
    }).find((object) => object.kind === "light")?.representationKey;
  }

  it("rebuilds when the reach changes, because the wire is that size", () => {
    expect(keyFor({ radius: 5 })).not.toBe(keyFor({ radius: 9 }));
  });

  it("rebuilds when a spot's cone widens", () => {
    expect(
      keyFor({
        kind: "spot",
        spot: { angleDeg: 20, penumbra: 0, projectedTextureId: null }
      })
    ).not.toBe(
      keyFor({
        kind: "spot",
        spot: { angleDeg: 60, penumbra: 0, projectedTextureId: null }
      })
    );
  });

  it("rebuilds when an area light is resized", () => {
    expect(keyFor({ kind: "area", area: { width: 2, height: 2 } })).not.toBe(
      keyFor({ kind: "area", area: { width: 4, height: 2 } })
    );
  });

  it("keeps the wire it has when only colour or intensity changes", () => {
    expect(keyFor({ color: 0x00ff00, intensity: 40 })).toBe(
      keyFor({ color: 0xff0000, intensity: 2 })
    );
  });
});
