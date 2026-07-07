/**
 * packages/io/src/glb/index.ts
 *
 * Purpose: Plan 062 §062.4 — GLB binary-container I/O for the
 * Character Wizard: chunk reading, chunk packing, mesh
 * extraction (GLB -> the character-rig MeshData struct),
 * skinned-model assembly (static GLB + generated skeleton +
 * solved weights -> animated-ready GLB), and hips-track scaling
 * for clip copies.
 *
 * The writer strategy is MERGE, not rebuild: the source GLB's
 * JSON and binary chunk pass through untouched, and everything
 * skinning needs (bone nodes, skin, inverse bind matrices,
 * JOINTS_0/WEIGHTS_0) is APPENDED — existing accessor offsets
 * stay valid, materials/textures ride along unmodified.
 *
 * v1 constraints (documented wizard input contract): POSITION
 * accessors must be float32 VEC3 (interleaved byteStride
 * supported); indices u16/u32 (unindexed primitives synthesize
 * sequential indices).
 *
 * Status: active
 */

import type {
  GeneratedSkeleton,
  SkinWeights
} from "@sugarmagic/character-rig";
import { MAX_INFLUENCES, quatMultiply } from "@sugarmagic/character-rig";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;

/** Loose glTF JSON shape — the container layer stays schema-light. */
export interface GltfJson {
  asset?: { version?: string; [key: string]: unknown };
  scene?: number;
  scenes?: Array<{ nodes?: number[]; [key: string]: unknown }>;
  nodes?: Array<{
    name?: string;
    mesh?: number;
    skin?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    [key: string]: unknown;
  }>;
  meshes?: Array<{
    primitives?: Array<{
      attributes?: Record<string, number>;
      indices?: number;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  skins?: Array<{
    joints: number[];
    inverseBindMatrices?: number;
    skeleton?: number;
    [key: string]: unknown;
  }>;
  animations?: Array<{
    name?: string;
    channels: Array<{
      sampler: number;
      target: { node?: number; path: string };
    }>;
    samplers: Array<{ input: number; output: number; interpolation?: string }>;
  }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
    [key: string]: unknown;
  }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    [key: string]: unknown;
  }>;
  buffers?: Array<{ byteLength: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface GlbChunks {
  document: GltfJson;
  binaryChunk: Uint8Array | null;
}

export function readGlb(buffer: ArrayBuffer): GlbChunks | null {
  if (buffer.byteLength < 20) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  const declaredLength = view.getUint32(8, true);
  const totalLength = Math.min(declaredLength, buffer.byteLength);
  let offset = 12;
  let document: GltfJson | null = null;
  let binaryChunk: Uint8Array | null = null;
  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > totalLength) return null;
    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      const bytes = new Uint8Array(buffer, chunkStart, chunkLength);
      const rawText = new TextDecoder().decode(bytes);
      let end = rawText.length;
      while (end > 0 && rawText.charCodeAt(end - 1) === 0) end -= 1;
      try {
        document = JSON.parse(rawText.slice(0, end)) as GltfJson;
      } catch {
        return null;
      }
    } else {
      binaryChunk = new Uint8Array(buffer, chunkStart, chunkLength);
    }
    offset = chunkEnd;
  }
  return document ? { document, binaryChunk } : null;
}

export function packGlb(document: GltfJson, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = (4 - (bin.length % 4)) % 4;
  const total =
    12 + 8 + jsonBytes.length + jsonPadding + 8 + bin.length + binPadding;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length + jsonPadding, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPadding);
  const binHeader = 20 + jsonBytes.length + jsonPadding;
  view.setUint32(binHeader, bin.length + binPadding, true);
  view.setUint32(binHeader + 4, GLB_BIN_CHUNK_TYPE, true);
  bytes.set(bin, binHeader + 8);
  return out;
}

// ---- Node world transforms -------------------------------------------

type Mat4 = number[]; // column-major, length 16

const MAT4_IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function mat4FromTrs(
  translation: number[] = [0, 0, 0],
  rotation: number[] = [0, 0, 0, 1],
  scale: number[] = [1, 1, 1]
): Mat4 {
  const [x, y, z, w] = rotation as [number, number, number, number];
  const [sx, sy, sz] = scale as [number, number, number];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    (2 * (x * y + w * z)) * sx,
    (2 * (x * z - w * y)) * sx,
    0,
    (2 * (x * y - w * z)) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    (2 * (y * z + w * x)) * sy,
    0,
    (2 * (x * z + w * y)) * sz,
    (2 * (y * z - w * x)) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    translation[0]!,
    translation[1]!,
    translation[2]!,
    1
  ];
}

function mat4ApplyToPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  ];
}

function mat4NearlyEqual(a: Mat4, b: Mat4): boolean {
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs(a[i]! - b[i]!) > 1e-5) return false;
  }
  return true;
}

/**
 * World matrix per node index (scene-graph walk). glTF nodes may
 * carry either a `matrix` or TRS; both are honored.
 */
function computeNodeWorldMatrices(document: GltfJson): Map<number, Mat4> {
  const world = new Map<number, Mat4>();
  const visit = (nodeIndex: number, parent: Mat4) => {
    const node = document.nodes?.[nodeIndex];
    if (!node) return;
    const local = Array.isArray(node.matrix)
      ? (node.matrix as Mat4)
      : mat4FromTrs(node.translation, node.rotation, node.scale);
    const matrix = mat4Multiply(parent, local);
    world.set(nodeIndex, matrix);
    for (const child of node.children ?? []) visit(child, matrix);
  };
  const scene = document.scenes?.[document.scene ?? 0];
  for (const root of scene?.nodes ?? []) visit(root, MAT4_IDENTITY);
  return world;
}

// ---- Mesh extraction -------------------------------------------------

export interface ExtractedPrimitiveRange {
  meshIndex: number;
  primitiveIndex: number;
  /** First vertex of this primitive in the flattened arrays. */
  vertexStart: number;
  vertexCount: number;
  /** World matrix of the node that references this mesh (baked
   *  into the extracted positions; folded into the skin's IBMs
   *  at assembly — glTF loaders ignore skinned-node transforms). */
  nodeWorldMatrix: number[];
}

export interface ExtractedMesh {
  positions: Float32Array;
  indices: Uint32Array;
  ranges: ExtractedPrimitiveRange[];
}

function decodePositions(
  document: GltfJson,
  bin: Uint8Array,
  accessorIndex: number
): Float32Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== "VEC3") {
    throw new Error(
      "Character Wizard v1 requires float32 VEC3 POSITION attributes."
    );
  }
  const viewDef = document.bufferViews?.[accessor.bufferView ?? -1];
  if (!viewDef) throw new Error("POSITION accessor has no bufferView.");
  const stride = viewDef.byteStride ?? 12;
  const base =
    bin.byteOffset + (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer);
  const out = new Float32Array(accessor.count * 3);
  for (let i = 0; i < accessor.count; i += 1) {
    out[i * 3] = view.getFloat32(base + i * stride, true);
    out[i * 3 + 1] = view.getFloat32(base + i * stride + 4, true);
    out[i * 3 + 2] = view.getFloat32(base + i * stride + 8, true);
  }
  return out;
}

function decodeIndices(
  document: GltfJson,
  bin: Uint8Array,
  accessorIndex: number
): Uint32Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor) throw new Error("missing indices accessor");
  const viewDef = document.bufferViews?.[accessor.bufferView ?? -1];
  if (!viewDef) throw new Error("indices accessor has no bufferView.");
  const base =
    bin.byteOffset + (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer);
  const out = new Uint32Array(accessor.count);
  if (accessor.componentType === 5123) {
    for (let i = 0; i < accessor.count; i += 1) {
      out[i] = view.getUint16(base + i * 2, true);
    }
  } else if (accessor.componentType === 5125) {
    for (let i = 0; i < accessor.count; i += 1) {
      out[i] = view.getUint32(base + i * 4, true);
    }
  } else if (accessor.componentType === 5121) {
    for (let i = 0; i < accessor.count; i += 1) {
      out[i] = bin[base - bin.byteOffset + i]!;
    }
  } else {
    throw new Error(`unsupported index componentType ${accessor.componentType}`);
  }
  return out;
}

/**
 * Flatten every primitive's positions + triangles into one
 * MeshData-shaped pair, recording per-primitive vertex ranges so
 * solved weights can be routed back to their primitives.
 */
export function extractMeshFromGlb(buffer: ArrayBuffer): ExtractedMesh {
  const chunks = readGlb(buffer);
  if (!chunks?.binaryChunk) {
    throw new Error("Not a valid GLB (missing JSON or BIN chunk).");
  }
  const { document, binaryChunk } = chunks;
  // Node transforms are BAKED into the extracted positions so
  // detection, markers, and the weight solve all run in the same
  // space the viewer renders (the 2026-07-06 marker-offset bug —
  // Blender exports often carry the up-axis fix as a node
  // rotation, leaving accessor data in Z-up local space).
  const nodeWorld = computeNodeWorldMatrices(document);
  const worldForMesh = new Map<number, Mat4>();
  (document.nodes ?? []).forEach((node, nodeIndex) => {
    if (node.mesh !== undefined && !worldForMesh.has(node.mesh)) {
      worldForMesh.set(node.mesh, nodeWorld.get(nodeIndex) ?? MAT4_IDENTITY);
    }
  });
  const positionsParts: Float32Array[] = [];
  const indexParts: Uint32Array[] = [];
  const ranges: ExtractedPrimitiveRange[] = [];
  let vertexBase = 0;
  (document.meshes ?? []).forEach((mesh, meshIndex) => {
    (mesh.primitives ?? []).forEach((primitive, primitiveIndex) => {
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) return;
      const positions = decodePositions(document, binaryChunk, positionAccessor);
      const meshWorld = worldForMesh.get(meshIndex) ?? MAT4_IDENTITY;
      for (let i = 0; i < positions.length; i += 3) {
        const [px, py, pz] = mat4ApplyToPoint(
          meshWorld,
          positions[i]!,
          positions[i + 1]!,
          positions[i + 2]!
        );
        positions[i] = px;
        positions[i + 1] = py;
        positions[i + 2] = pz;
      }
      const vertexCount = positions.length / 3;
      let indices: Uint32Array;
      if (primitive.indices !== undefined) {
        indices = decodeIndices(document, binaryChunk, primitive.indices);
      } else {
        indices = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i += 1) indices[i] = i;
      }
      const shifted = new Uint32Array(indices.length);
      for (let i = 0; i < indices.length; i += 1) {
        shifted[i] = indices[i]! + vertexBase;
      }
      positionsParts.push(positions);
      indexParts.push(shifted);
      ranges.push({
        meshIndex,
        primitiveIndex,
        vertexStart: vertexBase,
        vertexCount,
        nodeWorldMatrix: worldForMesh.get(meshIndex) ?? MAT4_IDENTITY
      });
      vertexBase += vertexCount;
    });
  });
  const totalPositions = positionsParts.reduce((sum, part) => sum + part.length, 0);
  const positions = new Float32Array(totalPositions);
  let offset = 0;
  for (const part of positionsParts) {
    positions.set(part, offset);
    offset += part.length;
  }
  const totalIndices = indexParts.reduce((sum, part) => sum + part.length, 0);
  const indices = new Uint32Array(totalIndices);
  offset = 0;
  for (const part of indexParts) {
    indices.set(part, offset);
    offset += part.length;
  }
  return { positions, indices, ranges };
}

// ---- Skinned assembly ------------------------------------------------

interface BinAppender {
  parts: Uint8Array[];
  offset: number;
}

function appendToBin(
  appender: BinAppender,
  document: GltfJson,
  data: Uint8Array,
  accessor: { componentType: number; count: number; type: string }
): number {
  const padded = (4 - (appender.offset % 4)) % 4;
  if (padded > 0) {
    appender.parts.push(new Uint8Array(padded));
    appender.offset += padded;
  }
  document.bufferViews!.push({
    buffer: 0,
    byteOffset: appender.offset,
    byteLength: data.byteLength
  });
  appender.parts.push(data);
  appender.offset += data.byteLength;
  document.accessors!.push({
    ...accessor,
    bufferView: document.bufferViews!.length - 1
  });
  return document.accessors!.length - 1;
}

/** Column-major inverse of a rotation+translation rest transform. */
function inverseBindMatrix(
  rotation: readonly [number, number, number, number],
  translation: readonly [number, number, number]
): number[] {
  const [x, y, z, w] = rotation;
  // Rotation matrix from quaternion (row-major r[row][col]).
  const r = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
  ];
  // Inverse: R^T, -R^T * t.
  const it = [
    -(r[0]![0]! * translation[0] + r[1]![0]! * translation[1] + r[2]![0]! * translation[2]),
    -(r[0]![1]! * translation[0] + r[1]![1]! * translation[1] + r[2]![1]! * translation[2]),
    -(r[0]![2]! * translation[0] + r[1]![2]! * translation[1] + r[2]![2]! * translation[2])
  ];
  // glTF matrices are column-major.
  return [
    r[0]![0]!, r[0]![1]!, r[0]![2]!, 0,
    r[1]![0]!, r[1]![1]!, r[1]![2]!, 0,
    r[2]![0]!, r[2]![1]!, r[2]![2]!, 0,
    it[0]!, it[1]!, it[2]!, 1
  ];
}

export interface BuildSkinnedGlbRequest {
  sourceGlb: ArrayBuffer;
  skeleton: GeneratedSkeleton;
  weights: SkinWeights;
  ranges: ExtractedPrimitiveRange[];
  /** Plan 062 §062.9 — the wizard recipe, stamped into the output
   *  GLB's asset.extras so Edit can reopen this character with
   *  its markers intact. */
  recipe?: {
    landmarks: Record<string, [number, number, number]>;
    /** Project-relative path of the untouched source GLB kept
     *  alongside the rigged output. */
    sourceAssetPath: string;
  };
}

/**
 * Merge the generated skeleton + solved weights into the source
 * GLB: append bone nodes, the skin (with inverse bind matrices),
 * and per-primitive JOINTS_0/WEIGHTS_0; point mesh nodes at the
 * skin. Everything original passes through untouched.
 */
export function buildSkinnedCharacterGlb(
  request: BuildSkinnedGlbRequest
): ArrayBuffer {
  const chunks = readGlb(request.sourceGlb);
  if (!chunks?.binaryChunk) {
    throw new Error("Not a valid GLB (missing JSON or BIN chunk).");
  }
  const document = chunks.document;
  document.nodes = document.nodes ?? [];
  document.accessors = document.accessors ?? [];
  document.bufferViews = document.bufferViews ?? [];
  document.skins = document.skins ?? [];
  if (request.recipe) {
    document.asset = {
      ...(document.asset ?? { version: "2.0" }),
      extras: {
        ...((document.asset?.extras as Record<string, unknown>) ?? {}),
        sugarmagicRig: {
          rigId: request.skeleton.rigId,
          rigSchemaVersion: request.skeleton.rigSchemaVersion,
          landmarks: request.recipe.landmarks,
          sourceAssetPath: request.recipe.sourceAssetPath
        }
      }
    };
  }

  const appender: BinAppender = {
    parts: [chunks.binaryChunk],
    offset: chunks.binaryChunk.byteLength
  };

  // 1. Bone nodes (contract order), hierarchy, scene root.
  const boneNodeIndex = new Map<string, number>();
  for (const bone of request.skeleton.bones) {
    const nodeIndex = document.nodes.length;
    boneNodeIndex.set(bone.name, nodeIndex);
    document.nodes.push({
      name: bone.name,
      translation: [...bone.localRestTranslation],
      rotation: [...bone.localRestRotation]
    });
    if (bone.parentName) {
      const parentIndex = boneNodeIndex.get(bone.parentName)!;
      const parent = document.nodes[parentIndex]!;
      parent.children = [...(parent.children ?? []), nodeIndex];
    }
  }
  const rootBone = request.skeleton.bones.find((bone) => !bone.parentName)!;
  const rootNodeIndex = boneNodeIndex.get(rootBone.name)!;
  const scene = document.scenes?.[document.scene ?? 0];
  if (scene) scene.nodes = [...(scene.nodes ?? []), rootNodeIndex];

  // 2. Inverse bind matrices from the character's world rest pose
  // (world rotation composed down the chain; world position = the
  // generated head). The mesh node's world transform is FOLDED in
  // (IBM' = IBM * M): glTF loaders ignore a skinned node's own
  // transform, but the vertices still live in node-local space —
  // folding M makes joint deformation land where the extraction
  // (which baked M) said the mesh is. v1 supports one shared mesh
  // transform; distinct per-primitive transforms are rejected
  // with a clear error.
  const meshWorldMatrix = request.ranges[0]?.nodeWorldMatrix ?? [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
  ];
  for (const range of request.ranges) {
    if (!mat4NearlyEqual(range.nodeWorldMatrix, meshWorldMatrix)) {
      throw new Error(
        "Character Wizard v1 requires all mesh primitives to share one node transform."
      );
    }
  }
  const worldRotation = new Map<string, [number, number, number, number]>();
  const ibm = new Float32Array(request.skeleton.bones.length * 16);
  request.skeleton.bones.forEach((bone, index) => {
    const parentRotation = bone.parentName
      ? worldRotation.get(bone.parentName)!
      : ([0, 0, 0, 1] as [number, number, number, number]);
    const rotation = quatMultiply(parentRotation, bone.localRestRotation) as [
      number, number, number, number
    ];
    worldRotation.set(bone.name, rotation);
    const folded = mat4Multiply(
      inverseBindMatrix(rotation, bone.headPosition),
      meshWorldMatrix
    );
    ibm.set(folded, index * 16);
  });
  const ibmAccessor = appendToBin(
    appender,
    document,
    new Uint8Array(ibm.buffer, 0, ibm.byteLength),
    { componentType: 5126, count: request.skeleton.bones.length, type: "MAT4" }
  );

  // 3. The skin.
  document.skins.push({
    joints: request.skeleton.bones.map((bone) => boneNodeIndex.get(bone.name)!),
    inverseBindMatrices: ibmAccessor,
    skeleton: rootNodeIndex
  });
  const skinIndex = document.skins.length - 1;

  // Weight boneOrder -> skin joint slot.
  const jointSlotByBoneName = new Map<string, number>();
  request.skeleton.bones.forEach((bone, index) => {
    jointSlotByBoneName.set(bone.name, index);
  });
  const slotForWeightColumn = request.weights.boneOrder.map((boneName) => {
    const slot = jointSlotByBoneName.get(boneName);
    if (slot === undefined) {
      throw new Error(`weights reference unknown bone: ${boneName}`);
    }
    return slot;
  });

  // 4. JOINTS_0 / WEIGHTS_0 per primitive range.
  for (const range of request.ranges) {
    const joints = new Uint16Array(range.vertexCount * MAX_INFLUENCES);
    const weights = new Float32Array(range.vertexCount * MAX_INFLUENCES);
    for (let vertex = 0; vertex < range.vertexCount; vertex += 1) {
      const flat = range.vertexStart + vertex;
      for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
        const column = request.weights.joints[flat * MAX_INFLUENCES + slot]!;
        joints[vertex * MAX_INFLUENCES + slot] = slotForWeightColumn[column]!;
        weights[vertex * MAX_INFLUENCES + slot] =
          request.weights.weights[flat * MAX_INFLUENCES + slot]!;
      }
    }
    const jointsAccessor = appendToBin(
      appender,
      document,
      new Uint8Array(joints.buffer, 0, joints.byteLength),
      { componentType: 5123, count: range.vertexCount, type: "VEC4" }
    );
    const weightsAccessor = appendToBin(
      appender,
      document,
      new Uint8Array(weights.buffer, 0, weights.byteLength),
      { componentType: 5126, count: range.vertexCount, type: "VEC4" }
    );
    const primitive =
      document.meshes![range.meshIndex]!.primitives![range.primitiveIndex]!;
    primitive.attributes = {
      ...(primitive.attributes ?? {}),
      JOINTS_0: jointsAccessor,
      WEIGHTS_0: weightsAccessor
    };
  }

  // 5. Point every mesh-bearing node at the skin.
  for (const node of document.nodes) {
    if (node.mesh !== undefined) node.skin = skinIndex;
  }

  // 6. Repack with the appended bin.
  const totalBin = appender.parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bin = new Uint8Array(totalBin);
  let offset = 0;
  for (const part of appender.parts) {
    bin.set(part, offset);
    offset += part.byteLength;
  }
  document.buffers = [{ ...(document.buffers?.[0] ?? {}), byteLength: totalBin }];
  return packGlb(document, bin);
}

// ---- Wizard reopen (§062.9) -------------------------------------------

export interface WizardRecipe {
  rigId: string;
  rigSchemaVersion: number;
  landmarks: Record<string, [number, number, number]>;
  sourceAssetPath: string;
}

/** Read the wizard recipe stamped by `buildSkinnedCharacterGlb`. */
export function readWizardRecipe(riggedGlb: ArrayBuffer): WizardRecipe | null {
  const chunks = readGlb(riggedGlb);
  const extras = chunks?.document.asset?.extras as
    | { sugarmagicRig?: WizardRecipe }
    | undefined;
  return extras?.sugarmagicRig ?? null;
}

/**
 * Decode the (possibly hand-painted) skin weights back out of a
 * rigged GLB into flattened per-vertex (jointSlot, weight) pairs,
 * in extraction order. The caller converts joint slots to solver
 * bone columns via the reconstructed skeleton.
 */
export function readSkinWeightsFromGlb(riggedGlb: ArrayBuffer): {
  joints: Uint16Array;
  weights: Float32Array;
} | null {
  const chunks = readGlb(riggedGlb);
  if (!chunks?.binaryChunk) return null;
  const { document, binaryChunk } = chunks;
  const jointsParts: Uint16Array[] = [];
  const weightsParts: Float32Array[] = [];
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const jointsAccessor = primitive.attributes?.JOINTS_0;
      const weightsAccessor = primitive.attributes?.WEIGHTS_0;
      const positionAccessor = primitive.attributes?.POSITION;
      if (
        jointsAccessor === undefined ||
        weightsAccessor === undefined ||
        positionAccessor === undefined
      ) {
        continue;
      }
      const jointsDef = document.accessors![jointsAccessor]!;
      const weightsDef = document.accessors![weightsAccessor]!;
      const jointsView = document.bufferViews![jointsDef.bufferView!]!;
      const weightsView = document.bufferViews![weightsDef.bufferView!]!;
      const view = new DataView(binaryChunk.buffer, binaryChunk.byteOffset);
      const j = new Uint16Array(jointsDef.count * 4);
      const jBase = (jointsView.byteOffset ?? 0) + (jointsDef.byteOffset ?? 0);
      for (let i = 0; i < j.length; i += 1) {
        j[i] =
          jointsDef.componentType === 5121
            ? view.getUint8(jBase + i)
            : view.getUint16(jBase + i * 2, true);
      }
      const w = new Float32Array(weightsDef.count * 4);
      const wBase =
        (weightsView.byteOffset ?? 0) + (weightsDef.byteOffset ?? 0);
      for (let i = 0; i < w.length; i += 1) {
        w[i] = view.getFloat32(wBase + i * 4, true);
      }
      jointsParts.push(j);
      weightsParts.push(w);
    }
  }
  if (jointsParts.length === 0) return null;
  const totalJ = jointsParts.reduce((sum, part) => sum + part.length, 0);
  const joints = new Uint16Array(totalJ);
  const weights = new Float32Array(totalJ);
  let offset = 0;
  for (let i = 0; i < jointsParts.length; i += 1) {
    joints.set(jointsParts[i]!, offset);
    weights.set(weightsParts[i]!, offset);
    offset += jointsParts[i]!.length;
  }
  return { joints, weights };
}

// ---- Clip hips scaling -----------------------------------------------

/**
 * Scale a clip's DEF-hips translation tracks by
 * (character hipHeight / library-rig hipHeight) so library-
 * proportioned root motion doesn't sink short characters or
 * float tall ones. Everything else passes through byte-exact.
 */
export function scaleClipHipsTranslation(
  clipGlb: ArrayBuffer,
  hipScale: number
): ArrayBuffer {
  const chunks = readGlb(clipGlb);
  if (!chunks?.binaryChunk) {
    throw new Error("Not a valid clip GLB.");
  }
  const { document } = chunks;
  const bin = new Uint8Array(chunks.binaryChunk);
  const hipsNodeIndices = new Set<number>();
  (document.nodes ?? []).forEach((node, index) => {
    if (node.name === "DEF-hips") hipsNodeIndices.add(index);
  });
  for (const animation of document.animations ?? []) {
    for (const channel of animation.channels) {
      if (
        channel.target.path !== "translation" ||
        channel.target.node === undefined ||
        !hipsNodeIndices.has(channel.target.node)
      ) {
        continue;
      }
      const sampler = animation.samplers[channel.sampler]!;
      const accessor = document.accessors?.[sampler.output];
      if (!accessor || accessor.componentType !== 5126) continue;
      const viewDef = document.bufferViews?.[accessor.bufferView ?? -1];
      if (!viewDef) continue;
      const base = (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const view = new DataView(bin.buffer, bin.byteOffset);
      const floatCount = accessor.count * 3;
      for (let i = 0; i < floatCount; i += 1) {
        view.setFloat32(
          base + i * 4,
          view.getFloat32(base + i * 4, true) * hipScale,
          true
        );
      }
      // Keep min/max annotations consistent if present.
      if (accessor.min) accessor.min = accessor.min.map((v) => v * hipScale);
      if (accessor.max) accessor.max = accessor.max.map((v) => v * hipScale);
    }
  }
  return packGlb(document, bin);
}
