import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  createDefaultRegionLandscapeState
} from "@sugarmagic/domain";
import {
  createLandscapeSceneController,
  resolveLandscapeDescriptor
} from "@sugarmagic/runtime-core";

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
});
