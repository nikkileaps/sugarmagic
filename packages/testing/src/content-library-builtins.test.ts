/**
 * Content-library starter content regression tests.
 *
 * Verifies that a fresh project snapshot ships the built-in Surface Library
 * starter content promised by Epic 036 instead of relying on manual setup.
 */

import { describe, expect, it } from "vitest";
import {
  createEmptyContentLibrarySnapshot,
  normalizeContentLibrarySnapshot
} from "@sugarmagic/domain";

describe("content-library built-ins", () => {
  it("seeds starter grass, flower, rock, and surface definitions into a fresh snapshot", () => {
    const snapshot = createEmptyContentLibrarySnapshot("little-world");
    const materialDefinitions = snapshot.materialDefinitions ?? [];
    const grassTypeDefinitions = snapshot.grassTypeDefinitions ?? [];
    const flowerTypeDefinitions = snapshot.flowerTypeDefinitions ?? [];
    const rockTypeDefinitions = snapshot.rockTypeDefinitions ?? [];
    const surfaceDefinitions = snapshot.surfaceDefinitions ?? [];
    const shaderDefinitions = snapshot.shaderDefinitions ?? [];

    expect(materialDefinitions.map((definition) => definition.displayName)).toEqual([
      "Meadow Grass",
      "Sunlit Lawn",
      "Autumn Field Grass",
      "Painterly Grass",
      "Grass Surface 2",
      "Grass Surface 3",
      "Grass Surface 4",
      "Grass Surface 6",
      "Still Air",
      "Gentle Breeze",
      "Meadow Breeze",
      "Gusty"
    ]);
    expect(grassTypeDefinitions.map((definition) => definition.displayName)).toEqual([
      "Short Lawn",
      "Wild Tall",
      "Autumn Golden",
      "Dry Sparse",
      "Painterly Tuft"
    ]);
    expect(flowerTypeDefinitions.map((definition) => definition.displayName)).toEqual([
      "White Meadow",
      "Yellow Buttercup",
      "Purple Wildflower"
    ]);
    expect(rockTypeDefinitions.map((definition) => definition.displayName)).toEqual([
      "Small Field Stones"
    ]);
    expect(surfaceDefinitions.map((definition) => definition.displayName)).toEqual([
      "Wildflower Meadow",
      "Autumn Field",
      "Mossy Bark",
      "Manicured Lawn",
      "Clover Patch",
      "Painterly Grass"
    ]);
    expect(
      shaderDefinitions
        .filter((definition) => {
          const builtInKey = String(definition.metadata?.builtInKey ?? "");
          return ["meadow-grass", "sunlit-lawn", "autumn-field-grass", "painterly-grass"].includes(
            builtInKey
          );
        })
        .map((definition) => definition.displayName)
    ).toEqual([
      "Meadow Grass",
      "Sunlit Lawn",
      "Autumn Field Grass",
      "Painterly Grass"
    ]);

    const painterlyGrass = surfaceDefinitions.find(
      (definition) => definition.displayName === "Painterly Grass"
    );
    expect(
      painterlyGrass?.surface.layers.find(
        (layer) => layer.kind === "scatter" && layer.displayName === "Painterly Tufts"
      )
    ).toMatchObject({
      kind: "scatter",
      materialDefinitionId: "little-world:material:grass-surface-4"
    });
  });

  it("re-adds starter material, surface, and scatter content during normalization if an older document is missing it", () => {
    const normalized = normalizeContentLibrarySnapshot(
      {
        ...createEmptyContentLibrarySnapshot("little-world"),
        materialDefinitions: [],
        surfaceDefinitions: [],
        grassTypeDefinitions: [],
        flowerTypeDefinitions: [],
        rockTypeDefinitions: []
      },
      "little-world"
    );

    expect(normalized.materialDefinitions).toHaveLength(12);
    expect(normalized.grassTypeDefinitions).toHaveLength(5);
    expect(normalized.flowerTypeDefinitions).toHaveLength(3);
    expect(normalized.rockTypeDefinitions).toHaveLength(1);
    expect(normalized.surfaceDefinitions).toHaveLength(6);
  });
});
