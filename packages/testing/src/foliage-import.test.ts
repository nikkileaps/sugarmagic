/**
 * Import-contract tests for foliage GLBs.
 *
 * Verifies that the Sugarmagic import boundary can distinguish canonical
 * foliage GLBs from generic model GLBs and fails loudly when required
 * foliage-authored inputs are missing.
 */

import { describe, expect, it } from "vitest";
import {
  analyzeSourceAssetFile,
  deriveFoliageEmbeddedMaterialImport
} from "@sugarmagic/io";

function createGlbFromJson(json: unknown): ArrayBuffer {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const totalLength = 12 + 8 + paddedJsonLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);

  const chunkBytes = new Uint8Array(buffer, 20, paddedJsonLength);
  chunkBytes.fill(0x20);
  chunkBytes.set(jsonBytes);

  return buffer;
}

function createValidFoilageMakerGlb(): File {
  return new File(
    [
      createGlbFromJson({
        asset: { version: "2.0" },
        nodes: [
          {
            mesh: 0,
            extras: {
              foilagemaker_kind: "tree",
              foilagemaker_leaf_color_rgb: "canopy_tint_gradient",
              foilagemaker_leaf_color_alpha: "sun_exterior_bias",
              foilagemaker_uv_layer: "UVMap"
            }
          }
        ],
        meshes: [
          {
            primitives: [
              {
                attributes: {
                  POSITION: 0,
                  NORMAL: 1,
                  TEXCOORD_0: 2,
                  COLOR_0: 3
                },
                material: 0
              }
            ]
          }
        ],
        materials: [
          {
            pbrMetallicRoughness: {
              baseColorTexture: { index: 0 }
            }
          }
        ],
        textures: [{ source: 0 }],
        images: [{ uri: "data:image/png;base64,AA==" }]
      })
    ],
    "stylized-tree.glb",
    { type: "model/gltf-binary" }
  );
}

describe("foliage GLB import analysis", () => {
  it("detects valid FoilageMaker exports as foliage assets", async () => {
    const analysis = await analyzeSourceAssetFile(createValidFoilageMakerGlb());

    expect(analysis.assetKind).toBe("foliage");
    expect(analysis.contract).toBe("foilagemaker-foliage");
  });

  it("keeps unmarked GLBs as generic model assets", async () => {
    const file = new File(
      [
        createGlbFromJson({
          asset: { version: "2.0" },
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }]
        })
      ],
      "crate.glb",
      { type: "model/gltf-binary" }
    );

    const analysis = await analyzeSourceAssetFile(file);

    expect(analysis.assetKind).toBe("model");
    expect(analysis.contract).toBe("generic-model");
  });

  it("fails loudly when a foliage-marked GLB is missing required payloads", async () => {
    const invalidFile = new File(
      [
        createGlbFromJson({
          asset: { version: "2.0" },
          nodes: [
            {
              mesh: 0,
              extras: {
                foilagemaker_kind: "tree",
                foilagemaker_leaf_color_rgb: "canopy_tint_gradient",
                foilagemaker_leaf_color_alpha: "sun_exterior_bias",
                foilagemaker_uv_layer: "UVMap"
              }
            }
          ],
          meshes: [
            {
              primitives: [
                {
                  attributes: {
                    POSITION: 0,
                    NORMAL: 1,
                    TEXCOORD_0: 2
                  },
                  material: 0
                }
              ]
            }
          ],
          materials: [{}],
          images: []
        })
      ],
      "broken-tree.glb",
      { type: "model/gltf-binary" }
    );

    await expect(analyzeSourceAssetFile(invalidFile)).rejects.toThrow(
      /Invalid foliage GLB contract:/
    );
    await expect(analyzeSourceAssetFile(invalidFile)).rejects.toThrow(
      /missing COLOR_0 primitive attribute/
    );
  });

  it("derives explicit foliage textures and materials from embedded GLB carriers", () => {
    const derived = deriveFoliageEmbeddedMaterialImport({
      projectId: "wordlark",
      assetStem: "tree-aspen-1",
      assetDisplayName: "tree_aspen_1",
      authoredAssetsPath: "assets",
      binaryChunk: null,
      document: {
        materials: [
          {
            name: "FoilageMaker Export Trunk",
            pbrMetallicRoughness: {
              baseColorTexture: { index: 0 }
            }
          },
          {
            name: "FoilageMaker Export Leaves",
            pbrMetallicRoughness: {
              baseColorTexture: { index: 1 }
            }
          }
        ],
        textures: [{ source: 0 }, { source: 1 }],
        images: [
          {
            name: "trunk_base",
            mimeType: "image/png",
            uri: "data:image/png;base64,AA=="
          },
          {
            name: "leaves_base",
            mimeType: "image/png",
            uri: "data:image/png;base64,AA=="
          }
        ]
      }
    });

    expect(derived.warnings).toEqual([]);
    expect(derived.textureDefinitions).toHaveLength(2);
    expect(derived.materialDefinitions).toHaveLength(2);
    expect(derived.files).toHaveLength(2);
    expect(derived.surfaceSlots).toEqual([
      {
        slotName: "FoilageMaker Export Trunk",
        slotIndex: 0,
        surface: {
          kind: "material",
          materialDefinitionId: "material:tree-aspen-1:foilagemaker-export-trunk:0"
        }
      },
      {
        slotName: "FoilageMaker Export Leaves",
        slotIndex: 1,
        surface: {
          kind: "material",
          materialDefinitionId: "material:tree-aspen-1:foilagemaker-export-leaves:1"
        }
      }
    ]);
    expect(derived.materialDefinitions).toEqual([
      expect.objectContaining({
        definitionId: "material:tree-aspen-1:foilagemaker-export-trunk:0",
        shaderDefinitionId: "wordlark:shader:standard-pbr",
        textureBindings: {
          basecolor_texture: "texture:tree-aspen-1:image-1"
        }
      }),
      expect.objectContaining({
        definitionId: "material:tree-aspen-1:foilagemaker-export-leaves:1",
        shaderDefinitionId: "wordlark:shader:foliage-surface-3",
        textureBindings: {
          baseColorTexture: "texture:tree-aspen-1:image-2"
        }
      })
    ]);
  });
});
