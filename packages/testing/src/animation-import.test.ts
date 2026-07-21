/**
 * Character animation import tests.
 *
 * Covers the IO boundary that turns an animation GLB into an authored
 * CharacterAnimationDefinition and the asset-import hint for
 * animation-only GLBs.
 */

import { describe, expect, it } from "vitest";
import {
  analyzeSourceAssetFile,
  cozySeedDefinitionId,
  importAnimationLibraryFromGlbFile,
  importCharacterAnimationDefinitionFromFile,
  seedCozyAnimations
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

function createAnimationOnlyGlb(): File {
  return new File(
    [
      createGlbFromJson({
        asset: { version: "2.0" },
        animations: [{ name: "Idle" }, { name: "Walk" }]
      })
    ],
    "character-motion.glb",
    { type: "model/gltf-binary" }
  );
}

function createMemoryDirectoryHandle() {
  const writes = new Map<string, Blob>();

  function directory(path: string[]): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: path[path.length - 1] ?? "root",
      async getDirectoryHandle(name: string) {
        return directory([...path, name]);
      },
      async getFileHandle(name: string) {
        const filePath = [...path, name].join("/");
        return {
          kind: "file",
          name,
          async createWritable() {
            return {
              async write(data: Blob) {
                writes.set(filePath, data);
              },
              async close() {
                return undefined;
              }
            };
          }
        } as unknown as FileSystemFileHandle;
      }
    } as unknown as FileSystemDirectoryHandle;
  }

  return {
    handle: directory([]),
    writes
  };
}

describe("character animation GLB imports", () => {
  it("extracts clip metadata into a CharacterAnimationDefinition", async () => {
    const { handle, writes } = createMemoryDirectoryHandle();
    const result = await importCharacterAnimationDefinitionFromFile(
      createAnimationOnlyGlb(),
      {
        projectHandle: handle,
        descriptor: {
          rootPath: ".",
          projectFileName: "project.sgrmagic",
          authoredAssetsPath: "assets",
          exportsPath: "exports",
          publishPath: "publish"
        },
        projectId: "little-world"
      }
    );

    expect(result.characterAnimationDefinition).toMatchObject({
      definitionId: "little-world:character-animation:character-motion",
      definitionKind: "character-animation",
      displayName: "character-motion",
      clipNames: ["Idle", "Walk"],
      source: {
        relativeAssetPath: "assets/character-animations/character-motion.glb",
        fileName: "character-motion.glb",
        mimeType: "model/gltf-binary"
      }
    });
    expect(writes.has("assets/character-animations/character-motion.glb")).toBe(
      true
    );
  });

  it("marks animation-only GLBs during source asset analysis", async () => {
    const analysis = await analyzeSourceAssetFile(createAnimationOnlyGlb());

    expect(analysis.assetKind).toBe("model");
    expect(analysis.contract).toBe("generic-model");
    expect(analysis.meshCount).toBe(0);
    expect(analysis.animationClipNames).toEqual(["Idle", "Walk"]);
  });
});

const TEST_DESCRIPTOR = {
  rootPath: ".",
  projectFileName: "project.sgrmagic",
  authoredAssetsPath: "assets",
  exportsPath: "exports",
  publishPath: "publish"
} as const;

function createRigAnimationGlb(nodeName: string): File {
  return new File(
    [
      createGlbFromJson({
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: nodeName }],
        animations: [
          {
            name: "Tail Wag",
            channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
            samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }]
          }
        ]
      })
    ],
    "blender-export.glb",
    { type: "model/gltf-binary" }
  );
}

describe("animation library GLB imports", () => {
  it("creates one library entry per clip, keyed off the filename + clip", async () => {
    const { handle, writes } = createMemoryDirectoryHandle();
    const result = await importAnimationLibraryFromGlbFile(
      createRigAnimationGlb("DEF-hips"),
      {
        projectHandle: handle,
        descriptor: TEST_DESCRIPTOR,
        projectId: "little-world"
      }
    );

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({
      definitionKind: "animation-library",
      displayName: "Tail Wag",
      origin: "imported",
      clipNames: ["Tail Wag"]
    });
    expect(result.definitions[0]?.definitionId).toContain(
      "little-world:animation-library:"
    );
    const writtenPath = result.definitions[0]?.source.relativeAssetPath;
    expect(writtenPath).toMatch(/^assets\/animations\//);
    expect(writes.has(writtenPath!)).toBe(true);
  });

  it("rejects GLBs whose animations target no standard-rig bones", async () => {
    const { handle } = createMemoryDirectoryHandle();
    await expect(
      importAnimationLibraryFromGlbFile(createRigAnimationGlb("Armature"), {
        projectHandle: handle,
        descriptor: TEST_DESCRIPTOR,
        projectId: "little-world"
      })
    ).rejects.toThrow(/No standard-rig bones/);
  });
});

describe("cozy animation seed", () => {
  it("generates the cozy clips once and skips ids already present", async () => {
    const { handle, writes } = createMemoryDirectoryHandle();
    const request = {
      projectHandle: handle,
      descriptor: TEST_DESCRIPTOR,
      projectId: "little-world"
    };

    const first = await seedCozyAnimations(request, new Set());
    expect(first.definitions.length).toBeGreaterThan(0);
    for (const definition of first.definitions) {
      expect(writes.has(definition.source.relativeAssetPath)).toBe(true);
    }
    // Well-known ids: the skip guard keys off cozySeedDefinitionId.
    for (const definition of first.definitions) {
      expect(
        definition.definitionId.startsWith("little-world:animation-library:")
      ).toBe(true);
    }

    const existing = new Set(first.definitions.map((d) => d.definitionId));
    const second = await seedCozyAnimations(request, existing);
    expect(second.definitions).toEqual([]);
    expect(second.writtenAssets).toEqual([]);
  });

  it("derives stable well-known seed ids", () => {
    expect(cozySeedDefinitionId("little-world", "cozy-idle")).toBe(
      cozySeedDefinitionId("little-world", "cozy-idle")
    );
  });
});
