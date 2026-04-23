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
  it("seeds starter grass, flower, and surface definitions into a fresh snapshot", () => {
    const snapshot = createEmptyContentLibrarySnapshot("little-world");
    const grassTypeDefinitions = snapshot.grassTypeDefinitions ?? [];
    const flowerTypeDefinitions = snapshot.flowerTypeDefinitions ?? [];
    const surfaceDefinitions = snapshot.surfaceDefinitions ?? [];

    expect(grassTypeDefinitions.map((definition) => definition.displayName)).toEqual([
      "Short Lawn",
      "Wild Tall",
      "Autumn Golden",
      "Dry Sparse"
    ]);
    expect(flowerTypeDefinitions.map((definition) => definition.displayName)).toEqual([
      "White Meadow",
      "Yellow Buttercup",
      "Purple Wildflower"
    ]);
    expect(surfaceDefinitions.map((definition) => definition.displayName)).toEqual([
      "Wildflower Meadow",
      "Autumn Field",
      "Mossy Bark",
      "Manicured Lawn",
      "Clover Patch"
    ]);
  });

  it("re-adds starter surface content during normalization if an older document is missing it", () => {
    const normalized = normalizeContentLibrarySnapshot(
      {
        ...createEmptyContentLibrarySnapshot("little-world"),
        surfaceDefinitions: [],
        grassTypeDefinitions: [],
        flowerTypeDefinitions: []
      },
      "little-world"
    );

    expect(normalized.grassTypeDefinitions).toHaveLength(4);
    expect(normalized.flowerTypeDefinitions).toHaveLength(3);
    expect(normalized.surfaceDefinitions).toHaveLength(5);
  });
});
