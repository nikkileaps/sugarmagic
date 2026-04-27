import { describe, expect, it } from "vitest";
import { createEmptyContentLibrarySnapshot } from "@sugarmagic/domain";
import { buildSurfaceScatterLayer, createAuthoredAssetResolver } from "@sugarmagic/render-web";

describe("rocks scatter", () => {
  it("realizes instanced rocks for a resolved rocks scatter layer", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const rockDefinition = contentLibrary.rockTypeDefinitions?.[0];
    if (!rockDefinition) {
      throw new Error("Expected starter rock definition.");
    }

    const build = buildSurfaceScatterLayer(
      {
        kind: "scatter",
        layerId: "field-stones",
        displayName: "Field Stones",
        enabled: true,
        opacity: 1,
        mask: { kind: "always" },
        contentKind: "rocks",
        definitionId: rockDefinition.definitionId,
        definition: rockDefinition,
        shaderDefinitionId: null,
        materialDefinitionId: null,
        appearanceBinding: null,
        density: 8,
        wind: null
      },
      [
        {
          position: [0, 0, 0],
          normal: [0, 1, 0],
          uv: [0.25, 0.25],
          height: 0
        },
        {
          position: [1, 0, 1],
          normal: [0, 1, 0],
          uv: [0.75, 0.75],
          height: 0
        }
      ],
      {
        contentLibrary,
        assetResolver: createAuthoredAssetResolver(),
        shaderRuntime: null
      }
    );

    expect(build.root.children.length).toBeGreaterThan(0);

    build.dispose();
  });
});
