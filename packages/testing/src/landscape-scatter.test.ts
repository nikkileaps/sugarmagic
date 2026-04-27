import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createDefaultRegion,
  createReferenceSurfaceBinding,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import {
  createAuthoredAssetResolver,
  createLandscapeSceneController
} from "@sugarmagic/render-web";

describe("landscape scatter", () => {
  it("realizes scatter layers for a built-in landscape surface", () => {
    const scene = new THREE.Scene();
    const controller = createLandscapeSceneController(
      scene,
      createAuthoredAssetResolver()
    );
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const region = createDefaultRegion({
      regionId: "glade",
      displayName: "Glade"
    });

    region.landscape.surfaceSlots[0] = {
      ...region.landscape.surfaceSlots[0],
      displayName: "Wildflower Meadow",
      surface: createReferenceSurfaceBinding("little-world:surface:wildflower-meadow")
    };

    controller.apply(region, contentLibrary);

    const landscapeRoot = controller.root.children[0] as THREE.Group | undefined;
    const scatterRoot = landscapeRoot?.children[1] as THREE.Group | undefined;
    expect(scatterRoot).toBeTruthy();
    expect(scatterRoot?.children.length ?? 0).toBeGreaterThan(0);

    controller.dispose();
  });
});
