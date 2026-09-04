/**
 * packages/domain/src/region-authoring/placed-light.test.ts
 *
 * Purpose: Pins what a placed light is in the domain — the factory that
 * keeps a light's kind and its kind-specific fields agreeing, the two
 * stores it can live in, how a Scene adds to and suppresses a region's
 * lights, what a region saved before lights existed loads as, and the four
 * commands that create, edit, remove and copy one.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createEmptyContentLibrarySnapshot } from "../content-library";
import { executeCommand } from "../commands/executor";
import type { AuthoringAggregateRef, SemanticCommand } from "../commands";
import type { SubjectReference } from "../shared/identity";
import { normalizeRegionDocumentForLoad } from "../io";
import {
  composeRegionContents,
  createDefaultScene,
  createRegionSceneOverlay,
  normalizeScene,
  type Scene
} from "../scenes";
import {
  createDefaultRegion,
  createPlacedLight,
  DEFAULT_PLACED_LIGHT_RADIUS,
  type PlacedLight,
  type RegionDocument
} from "./index";

const contentLibrary = createEmptyContentLibrarySnapshot("project:test");

function regionWithLights(lights: PlacedLight[]): RegionDocument {
  return {
    ...createDefaultRegion({
      regionId: "region:hollow",
      displayName: "The Hollow"
    }),
    placedLights: lights
  };
}

function sceneFor(
  region: RegionDocument,
  overlay: Partial<Scene["overlay"]> = {}
): Scene {
  return createDefaultScene({
    sceneId: "scene:night",
    regionId: region.identity.id,
    overlay: createRegionSceneOverlay(overlay)
  });
}

/** The routing every command carries: which document it edits, and which
 *  thing inside it. */
function addressedTo(
  region: RegionDocument,
  instanceId: string
): { target: AuthoringAggregateRef; subject: SubjectReference } {
  return {
    target: {
      aggregateKind: "region-document",
      aggregateId: region.identity.id
    },
    subject: { subjectKind: "placed-light", subjectId: instanceId }
  };
}

function run(
  region: RegionDocument,
  scene: Scene,
  command: SemanticCommand
): { region: RegionDocument; scene: Scene } {
  const result = executeCommand({ region, scene }, command);
  return { region: result.region, scene: result.scene };
}

describe("the placed light factory", () => {
  it("gives a point light a reach and no cone or rectangle", () => {
    const light = createPlacedLight({ kind: "point" });

    expect(light.radius).toBe(DEFAULT_PLACED_LIGHT_RADIUS);
    expect(light.spot).toBeNull();
    expect(light.area).toBeNull();
  });

  it("gives a spot light a cone and no rectangle", () => {
    const light = createPlacedLight({ kind: "spot" });

    expect(light.spot).not.toBeNull();
    expect(light.area).toBeNull();
  });

  it("gives an area light a rectangle and no reach cutoff", () => {
    const light = createPlacedLight({ kind: "area" });

    expect(light.area).toEqual({ width: 2, height: 2 });
    expect(light.radius).toBeNull();
    expect(light.spot).toBeNull();
  });

  it("drops fields that do not belong to the kind it is asked for", () => {
    const light = createPlacedLight({
      kind: "point",
      area: { width: 4, height: 4 },
      spot: { angleDeg: 10, penumbra: 0, projectedTextureId: "texture:window" }
    });

    expect(light.area).toBeNull();
    expect(light.spot).toBeNull();
  });

  it("seeds two lights differently so they do not flicker in step", () => {
    const first = createPlacedLight({ instanceId: "placed-light:a" });
    const second = createPlacedLight({ instanceId: "placed-light:b" });

    expect(first.modulation.seed).not.toBe(second.modulation.seed);
  });

  it("seeds the same light the same way on every load", () => {
    const first = createPlacedLight({ instanceId: "placed-light:a" });
    const again = createPlacedLight({ instanceId: "placed-light:a" });

    expect(again.modulation.seed).toBe(first.modulation.seed);
  });
});

describe("saving and loading a region's lights", () => {
  it("brings a light back unchanged", () => {
    const light = createPlacedLight({
      instanceId: "placed-light:hearth",
      kind: "spot",
      displayName: "Hearth",
      intensity: 12,
      spot: {
        angleDeg: 40,
        penumbra: 0.6,
        projectedTextureId: "texture:window"
      },
      modulation: {
        kind: "flame",
        speed: 3,
        amount: 0.4,
        colorWobble: 0.2,
        seed: 0.5
      },
      transform: { position: [1, 2, 3], rotation: [0, 1, 0], scale: [1, 1, 1] }
    });

    const loaded = normalizeRegionDocumentForLoad(
      regionWithLights([light]),
      contentLibrary
    );

    expect(loaded.placedLights).toEqual([light]);
  });

  it("loads a region saved before lights existed with none", () => {
    const { placedLights: _absent, ...beforeLights } = regionWithLights([]);

    const loaded = normalizeRegionDocumentForLoad(
      beforeLights as RegionDocument,
      contentLibrary
    );

    expect(loaded.placedLights).toEqual([]);
  });

  it("loads a Scene saved before lights existed with none", () => {
    const scene = normalizeScene({
      sceneId: "scene:night",
      displayName: "Night",
      regionId: "region:hollow",
      overlay: { placedAssets: [], folders: [] }
    });

    expect(scene?.overlay.placedLights).toEqual([]);
  });
});

describe("composing a region's lights with the active Scene", () => {
  const regionLight = createPlacedLight({
    instanceId: "placed-light:lantern",
    displayName: "Lantern"
  });
  const sceneLight = createPlacedLight({
    instanceId: "placed-light:candle",
    displayName: "Candle"
  });

  it("lights the region on its own when no Scene dresses it", () => {
    const region = regionWithLights([regionLight]);

    expect(composeRegionContents(region, null).placedLights).toEqual([
      regionLight
    ]);
  });

  it("adds the Scene's lights to the region's", () => {
    const region = regionWithLights([regionLight]);
    const scene = sceneFor(region, { placedLights: [sceneLight] });

    expect(composeRegionContents(region, scene).placedLights).toEqual([
      regionLight,
      sceneLight
    ]);
  });

  it("lets a Scene suppress one of the region's lights", () => {
    const region = regionWithLights([regionLight]);
    const scene = sceneFor(region, {
      placedLights: [sceneLight],
      suppressedRegionIds: [regionLight.instanceId]
    });

    expect(composeRegionContents(region, scene).placedLights).toEqual([
      sceneLight
    ]);
  });

  it("ignores a Scene that happens somewhere else", () => {
    const region = regionWithLights([regionLight]);
    const elsewhere = createDefaultScene({
      sceneId: "scene:market",
      regionId: "region:market",
      overlay: createRegionSceneOverlay({ placedLights: [sceneLight] })
    });

    expect(composeRegionContents(region, elsewhere).placedLights).toEqual([
      regionLight
    ]);
  });
});

describe("the placed light commands", () => {
  const light = createPlacedLight({
    instanceId: "placed-light:lantern",
    displayName: "Lantern"
  });

  it("places a light in the region when the scope is base", () => {
    const region = regionWithLights([]);
    const result = run(region, sceneFor(region), {
      ...addressedTo(region, light.instanceId),
      kind: "PlaceLight",
      payload: { light, scope: "base" }
    });

    expect(result.region.placedLights).toEqual([light]);
    expect(result.scene.overlay.placedLights).toEqual([]);
  });

  it("places a light in the Scene when the scope names one", () => {
    const region = regionWithLights([]);
    const scene = sceneFor(region);
    const result = run(region, scene, {
      ...addressedTo(region, light.instanceId),
      kind: "PlaceLight",
      payload: { light, scope: { sceneId: scene.sceneId } }
    });

    expect(result.region.placedLights).toEqual([]);
    expect(result.scene.overlay.placedLights).toEqual([light]);
  });

  it("turns a light off without deleting it", () => {
    const region = regionWithLights([light]);
    const result = run(region, sceneFor(region), {
      ...addressedTo(region, light.instanceId),
      kind: "UpdatePlacedLight",
      payload: { instanceId: light.instanceId, patch: { enabled: false } }
    });

    expect(result.region.placedLights[0]?.enabled).toBe(false);
  });

  it("drops the old kind's fields when a light changes kind", () => {
    const spot = createPlacedLight({
      instanceId: "placed-light:beam",
      kind: "spot"
    });
    const region = regionWithLights([spot]);

    const result = run(region, sceneFor(region), {
      ...addressedTo(region, spot.instanceId),
      kind: "UpdatePlacedLight",
      payload: { instanceId: spot.instanceId, patch: { kind: "area" } }
    });

    const changed = result.region.placedLights[0];
    expect(changed?.spot).toBeNull();
    expect(changed?.radius).toBeNull();
    expect(changed?.area).not.toBeNull();
  });

  it("edits a light the Scene owns, not just the region's", () => {
    const region = regionWithLights([]);
    const scene = sceneFor(region, { placedLights: [light] });

    const result = run(region, scene, {
      ...addressedTo(region, light.instanceId),
      kind: "UpdatePlacedLight",
      payload: { instanceId: light.instanceId, patch: { intensity: 20 } }
    });

    expect(result.scene.overlay.placedLights[0]?.intensity).toBe(20);
  });

  it("removes a light from whichever store holds it", () => {
    const region = regionWithLights([light]);
    const scene = sceneFor(region, { placedLights: [light] });

    const result = run(region, scene, {
      ...addressedTo(region, light.instanceId),
      kind: "RemovePlacedLight",
      payload: { instanceId: light.instanceId }
    });

    expect(result.region.placedLights).toEqual([]);
    expect(result.scene.overlay.placedLights).toEqual([]);
  });

  it("copies a region light into the region, offset and re-seeded", () => {
    const region = regionWithLights([light]);
    const result = run(region, sceneFor(region), {
      ...addressedTo(region, light.instanceId),
      kind: "DuplicatePlacedLight",
      payload: {
        sourceInstanceId: light.instanceId,
        duplicatedInstanceId: "placed-light:lantern-copy",
        positionOffset: [1, 0, 0]
      }
    });

    const copy = result.region.placedLights[1];
    expect(copy?.instanceId).toBe("placed-light:lantern-copy");
    expect(copy?.transform.position).toEqual([1, 0, 0]);
    expect(copy?.modulation.seed).not.toBe(light.modulation.seed);
    expect(result.scene.overlay.placedLights).toEqual([]);
  });

  it("copies a Scene light into the Scene", () => {
    const region = regionWithLights([]);
    const scene = sceneFor(region, { placedLights: [light] });

    const result = run(region, scene, {
      ...addressedTo(region, light.instanceId),
      kind: "DuplicatePlacedLight",
      payload: {
        sourceInstanceId: light.instanceId,
        duplicatedInstanceId: "placed-light:lantern-copy",
        positionOffset: [1, 0, 0]
      }
    });

    expect(result.region.placedLights).toEqual([]);
    expect(result.scene.overlay.placedLights).toHaveLength(2);
  });
});
