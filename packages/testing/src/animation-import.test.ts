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
  importCharacterAnimationDefinitionFromFile
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
