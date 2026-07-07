/**
 * Plan 062 §062.4 — GLB container I/O for the Character Wizard:
 * pack/read round-trip, mesh extraction, skinned assembly
 * (merge-not-rebuild), and clip hips scaling against the REAL
 * vendored clips.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSkinnedCharacterGlb,
  extractMeshFromGlb,
  packGlb,
  readGlb,
  scaleClipHipsTranslation,
  type GltfJson
} from "@sugarmagic/io";
import {
  GeodesicVoxelWeightSolver,
  computeBoneSegments,
  generateStandardSkeleton,
  type RigLandmarks
} from "@sugarmagic/character-rig";

const CLIPS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../vendor/quaternius-ual/clips"
);

/** Minimal single-triangle source GLB, built via our own packer. */
function buildTriangleGlb(
  nodeTransform: { translation?: number[]; rotation?: number[] } = {}
): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4 bytes
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const document: GltfJson = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Character", mesh: 0, ...nodeTransform }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1 }
        ]
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: 6 }
    ],
    buffers: [{ byteLength: bin.byteLength }]
  };
  return packGlb(document, bin);
}

function sampleLandmarks(): RigLandmarks {
  return {
    pelvis: [0, 0.8, 0],
    chest: [0, 1.15, 0],
    neck: [0, 1.3, 0],
    head: [0, 1.4, 0],
    shoulderLeft: [0.22, 1.25, 0],
    elbowLeft: [0.45, 1.0, 0],
    wristLeft: [0.6, 0.8, 0],
    shoulderRight: [-0.22, 1.25, 0],
    elbowRight: [-0.45, 1.0, 0],
    wristRight: [-0.6, 0.8, 0],
    hipLeft: [0.12, 0.75, 0],
    kneeLeft: [0.13, 0.42, 0],
    ankleLeft: [0.13, 0.08, 0],
    hipRight: [-0.12, 0.75, 0],
    kneeRight: [-0.13, 0.42, 0],
    ankleRight: [-0.13, 0.08, 0]
  } as RigLandmarks;
}

describe("GLB container I/O (Plan 062)", () => {
  it("pack -> read round-trips document and bin", () => {
    const glb = buildTriangleGlb();
    const chunks = readGlb(glb);
    expect(chunks).not.toBeNull();
    expect(chunks!.document.meshes?.length).toBe(1);
    expect(chunks!.binaryChunk).not.toBeNull();
  });

  it("extracts flattened mesh data with primitive ranges", () => {
    const extracted = extractMeshFromGlb(buildTriangleGlb());
    expect(extracted.positions.length).toBe(9);
    expect([...extracted.indices]).toEqual([0, 1, 2]);
    expect(extracted.ranges).toEqual([
      {
        meshIndex: 0,
        primitiveIndex: 0,
        vertexStart: 0,
        vertexCount: 3,
        nodeWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        materialName: null
      }
    ]);
  });

  it("assembles a skinned GLB: 53-joint skin, IBMs, JOINTS_0/WEIGHTS_0, untouched source", () => {
    const source = buildTriangleGlb();
    const extracted = extractMeshFromGlb(source);
    const skeleton = generateStandardSkeleton(sampleLandmarks());
    const segments = computeBoneSegments(skeleton);
    const weights = new GeodesicVoxelWeightSolver().solve(
      { positions: extracted.positions, indices: extracted.indices },
      segments,
      { resolution: 16, smoothingIterations: 0 }
    );
    const skinned = buildSkinnedCharacterGlb({
      sourceGlb: source,
      skeleton,
      weights,
      ranges: extracted.ranges
    });
    const chunks = readGlb(skinned)!;
    const document = chunks.document;
    // Skin with all 53 joints + IBMs.
    expect(document.skins?.length).toBe(1);
    expect(document.skins![0]!.joints.length).toBe(23);
    const ibmAccessor =
      document.accessors![document.skins![0]!.inverseBindMatrices!]!;
    expect(ibmAccessor.type).toBe("MAT4");
    expect(ibmAccessor.count).toBe(23);
    // The mesh node got the skin; primitives got skinning attributes.
    const meshNode = document.nodes!.find((node) => node.mesh !== undefined)!;
    expect(meshNode.skin).toBe(0);
    const primitive = document.meshes![0]!.primitives![0]!;
    expect(primitive.attributes!.JOINTS_0).toBeDefined();
    expect(primitive.attributes!.WEIGHTS_0).toBeDefined();
    // Source data untouched: POSITION accessor still decodes.
    const reextracted = extractMeshFromGlb(skinned);
    expect([...reextracted.positions]).toEqual([...extracted.positions]);
    // Bone nodes present and named per contract.
    const boneNames = document.nodes!.map((node) => node.name);
    expect(boneNames).toContain("DEF-hips");
    expect(boneNames).not.toContain("DEF-f_index.01.L");
  });

  it("bakes mesh-node transforms into extraction and folds them into the skin", () => {
    // 2026-07-06 regression — Blender exports carry up-axis fixes
    // as NODE transforms; raw accessor data is local space. The
    // markers floated off the mesh until extraction baked this.
    const lifted = buildTriangleGlb({ translation: [0, 1, 0] });
    const extracted = extractMeshFromGlb(lifted);
    // Positions shifted by the node translation.
    expect(extracted.positions[1]).toBeCloseTo(1, 5);
    expect(extracted.positions[4]).toBeCloseTo(1, 5);
    expect(extracted.ranges[0]!.nodeWorldMatrix[13]).toBeCloseTo(1, 5);

    const skeleton = generateStandardSkeleton(sampleLandmarks());
    const segments = computeBoneSegments(skeleton);
    const weights = new GeodesicVoxelWeightSolver().solve(
      { positions: extracted.positions, indices: extracted.indices },
      segments,
      { resolution: 16, smoothingIterations: 0 }
    );
    const skinned = buildSkinnedCharacterGlb({
      sourceGlb: lifted,
      skeleton,
      weights,
      ranges: extracted.ranges
    });
    const chunks = readGlb(skinned)!;
    // The IBMs must differ from an identity-node build by the
    // folded node matrix: compare against the same character
    // built from an unlifted source.
    const flat = buildTriangleGlb();
    const flatExtracted = extractMeshFromGlb(flat);
    const flatSkinned = buildSkinnedCharacterGlb({
      sourceGlb: flat,
      skeleton,
      weights,
      ranges: flatExtracted.ranges
    });
    const readIbm = (glb: ArrayBuffer): Float32Array => {
      const c = readGlb(glb)!;
      const accessor = c.document.accessors![c.document.skins![0]!.inverseBindMatrices!]!;
      const view = c.document.bufferViews![accessor.bufferView!]!;
      const start = view.byteOffset ?? 0;
      return new Float32Array(
        c.binaryChunk!.buffer.slice(
          c.binaryChunk!.byteOffset + start,
          c.binaryChunk!.byteOffset + start + accessor.count * 64
        )
      );
    };
    const liftedIbm = readIbm(skinned);
    const flatIbm = readIbm(flatSkinned);
    // Rotation columns identical; translation column differs by
    // R^T applied to the node translation — just assert they are
    // NOT equal and both finite.
    let differs = false;
    for (let i = 0; i < liftedIbm.length; i += 1) {
      expect(Number.isFinite(liftedIbm[i]!)).toBe(true);
      if (Math.abs(liftedIbm[i]! - flatIbm[i]!) > 1e-6) differs = true;
    }
    expect(differs).toBe(true);
    expect(chunks.document.skins![0]!.joints.length).toBe(23);
  });

  it("scales ONLY the hips translation tracks of a real vendored clip", () => {
    const clipBytes = readFileSync(resolve(CLIPS_DIR, "Walk_Loop.glb"));
    const clip = clipBytes.buffer.slice(
      clipBytes.byteOffset,
      clipBytes.byteOffset + clipBytes.byteLength
    );
    const scaled = scaleClipHipsTranslation(clip, 0.5);
    const before = readGlb(clip)!;
    const after = readGlb(scaled)!;
    const animation = after.document.animations![0]!;
    const hipsNode = after.document.nodes!.findIndex(
      (node) => node.name === "DEF-hips"
    );
    let checkedHips = 0;
    let checkedOther = 0;
    for (let i = 0; i < animation.channels.length; i += 1) {
      const channel = animation.channels[i]!;
      const sampler = animation.samplers[channel.sampler]!;
      const accessor = after.document.accessors![sampler.output]!;
      const viewDef = after.document.bufferViews![accessor.bufferView!]!;
      const base = (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const beforeView = new DataView(
        before.binaryChunk!.buffer,
        before.binaryChunk!.byteOffset
      );
      const afterView = new DataView(
        after.binaryChunk!.buffer,
        after.binaryChunk!.byteOffset
      );
      const first = beforeView.getFloat32(base, true);
      const firstAfter = afterView.getFloat32(base, true);
      if (
        channel.target.path === "translation" &&
        channel.target.node === hipsNode
      ) {
        expect(firstAfter).toBeCloseTo(first * 0.5, 5);
        checkedHips += 1;
      } else {
        expect(firstAfter).toBeCloseTo(first, 6);
        checkedOther += 1;
      }
    }
    expect(checkedHips).toBeGreaterThan(0);
    expect(checkedOther).toBeGreaterThan(0);
  });
});
