/**
 * A spot light shining through a texture, and what happens when the texture
 * it names is gone.
 *
 * The dangling case is the point: a light whose projection was deleted keeps
 * lighting the room and throws a plain cone. Going dark, or refusing the save,
 * would both be worse than losing a shape.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createPlacedLightController } from "@sugarmagic/render-web";
import {
  createDefaultSeason,
  createAuthoringSession,
  createDefaultEpisode,
  createDefaultGameProject,
  createDefaultScene,
  createRegionSceneOverlay,
  createDefaultRegion,
  createEmptyContentLibrarySnapshot,
  createPlacedLight,
  textureDefinitionHasReferences,
  validateProjectContent,
  type ContentLibrarySnapshot,
  type PlacedLight,
  type RegionDocument,
  type TextureDefinition
} from "@sugarmagic/domain";

const WINDOW_TEXTURE_ID = "texture:window-frame";

function spotThrough(projectedTextureId: string | null): PlacedLight {
  return createPlacedLight({
    instanceId: "placed-light:window",
    displayName: "Window",
    kind: "spot",
    spot: { angleDeg: 35, penumbra: 0.4, projectedTextureId }
  });
}

function libraryWithWindowTexture(): ContentLibrarySnapshot {
  const library = createEmptyContentLibrarySnapshot("project:test");
  const texture: TextureDefinition = {
    definitionId: WINDOW_TEXTURE_ID,
    definitionKind: "texture",
    displayName: "Window Frame",
    source: {
      relativeAssetPath: "textures/window-frame.png",
      fileName: "window-frame.png",
      mimeType: "image/png"
    },
    colorSpace: "srgb",
    packing: "rgba"
  };
  library.textureDefinitions.push(texture);
  return library;
}

function regionWith(lights: PlacedLight[]): RegionDocument {
  return {
    ...createDefaultRegion({
      regionId: "region:hollow",
      displayName: "The Hollow"
    }),
    placedLights: lights
  };
}

function onlySpot(scene: THREE.Scene): THREE.SpotLight {
  const spot = scene.children.find(
    (child): child is THREE.SpotLight => child instanceof THREE.SpotLight
  );
  expect(spot).toBeTruthy();
  return spot!;
}

describe("a spot light shining through a texture", () => {
  it("carries the texture it was pointed at", () => {
    const scene = new THREE.Scene();
    const projection = new THREE.Texture();
    const controller = createPlacedLightController(scene, (id) =>
      id === WINDOW_TEXTURE_ID ? projection : null
    );

    controller.apply([spotThrough(WINDOW_TEXTURE_ID)]);

    expect(onlySpot(scene).map).toBe(projection);
  });

  it("carries nothing when the author picked nothing", () => {
    const scene = new THREE.Scene();
    const controller = createPlacedLightController(scene, () => {
      throw new Error("should not be asked for a texture");
    });

    controller.apply([spotThrough(null)]);

    expect(onlySpot(scene).map).toBeNull();
  });

  it("keeps burning when the texture it names is gone", () => {
    const scene = new THREE.Scene();
    // The resolver answers null: the definition was deleted from the library.
    const controller = createPlacedLightController(scene, () => null);

    controller.apply([spotThrough(WINDOW_TEXTURE_ID)]);

    const spot = onlySpot(scene);
    expect(spot.map).toBeNull();
    expect(spot.intensity).toBeGreaterThan(0);
  });

  it("drops the projection when the author clears it", () => {
    const scene = new THREE.Scene();
    const projection = new THREE.Texture();
    const controller = createPlacedLightController(scene, () => projection);

    controller.apply([spotThrough(WINDOW_TEXTURE_ID)]);
    controller.apply([spotThrough(null)]);

    expect(onlySpot(scene).map).toBeNull();
  });
});

describe("what the save gate says about a missing texture", () => {
  const project = createDefaultGameProject("Test", "test");

  /**
   * Only what this check has an opinion about. The default project carries
   * unrelated complaints of its own, and folding those in would make these
   * cases fail for reasons that have nothing to do with lights.
   */
  function textureIssues(
    lights: PlacedLight[],
    library: ContentLibrarySnapshot
  ) {
    return validateProjectContent(
      project,
      [regionWith(lights)],
      library
    ).issues.filter((issue) => issue.message.includes("texture"));
  }

  it("says nothing when the texture is in the library", () => {
    expect(
      textureIssues(
        [spotThrough(WINDOW_TEXTURE_ID)],
        libraryWithWindowTexture()
      )
    ).toHaveLength(0);
  });

  it("warns when the texture is gone, rather than stopping the save", () => {
    const issues = textureIssues(
      [spotThrough(WINDOW_TEXTURE_ID)],
      createEmptyContentLibrarySnapshot("project:test")
    );

    expect(issues).toHaveLength(1);
    // A light throwing a plain cone is a look lost, not broken content.
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain(WINDOW_TEXTURE_ID);
  });

  it("says nothing about a light that projects nothing", () => {
    expect(
      textureIssues(
        [spotThrough(null)],
        createEmptyContentLibrarySnapshot("project:test")
      )
    ).toHaveLength(0);
  });

  it("says nothing about a point light, which cannot project at all", () => {
    expect(
      textureIssues(
        [createPlacedLight({ kind: "point" })],
        createEmptyContentLibrarySnapshot("project:test")
      )
    ).toHaveLength(0);
  });
});

describe("whether the Library will let a texture go", () => {
  function sessionWithLight(light: PlacedLight) {
    const session = createAuthoringSession(
      { ...createDefaultGameProject("Test", "test") },
      [regionWith([light])]
    );
    return {
      ...session,
      contentLibrary: libraryWithWindowTexture()
    };
  }

  it("holds on to a texture a spot light shines through", () => {
    // The delete affordance reads this. Saying "unreferenced" here is what
    // creates the dangling id the save-time check later complains about.
    expect(
      textureDefinitionHasReferences(
        sessionWithLight(spotThrough(WINDOW_TEXTURE_ID)),
        WINDOW_TEXTURE_ID
      )
    ).toBe(true);
  });

  it("lets go of one nothing points at", () => {
    expect(
      textureDefinitionHasReferences(
        sessionWithLight(spotThrough(null)),
        WINDOW_TEXTURE_ID
      )
    ).toBe(false);
  });
});

describe("a Scene's own lights", () => {
  it("are checked for dangling textures too, not just the region's", () => {
    const scene = createDefaultScene({
      sceneId: "scene:night",
      regionId: "region:hollow",
      overlay: createRegionSceneOverlay({
        placedLights: [spotThrough(WINDOW_TEXTURE_ID)]
      })
    });
    const project = {
      ...createDefaultGameProject("Test", "test"),
      seasons: [
        createDefaultSeason({
          episodes: [createDefaultEpisode({ scenes: [scene] })]
        })
      ]
    };

    const issues = validateProjectContent(
      project,
      [regionWith([])],
      createEmptyContentLibrarySnapshot("project:test")
    ).issues.filter((issue) => issue.message.includes("texture"));

    // A Scene-scoped light is the easiest one to forget: it is only visible
    // while that Scene is staged.
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
  });
});
