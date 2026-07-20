/**
 * Source-asset import boundary for the project content library.
 *
 * IO owns file picking, asset copying into the game root, and import-time GLB
 * contract validation. Domain meaning stays small here: this layer can
 * distinguish generic model assets from foliage assets, but it does not invent
 * runtime foliage behavior or editor-owned sidecar metadata.
 */

import {
  createDefaultAnimationLibraryDefinition,
  createDefaultAudioClipDefinition,
  createDefaultCharacterAnimationDefinition,
  createDefaultCharacterModelDefinition,
  defaultAssetColliderForKind,
  STANDARD_RIG_CORE_BONE_NAMES,
  type AnimationLibraryDefinition,
  type AssetDefinition,
  type AudioClipDefinition,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition,
  type MaterialDefinition,
  type MaskTextureDefinition,
  type TextureDefinition
} from "@sugarmagic/domain";
import { readGlb as readGlbFull, packGlb, type GltfJson } from "../glb";
import {
  listFilesInDirectory,
  pickDirectory,
  pickFile,
  writeBlobFile
} from "../fs-access";
import type { GameRootDescriptor } from "../game-root";
import {
  colorSpaceForPbrTextureRole,
  discoverPbrTextureSet,
  labelForPbrTextureRole,
  materialParameterIdForPbrTextureRole,
  packingForPbrTextureRole,
  type PbrTextureRole,
  type StandardPbrTextureParameterId
} from "./pbr-texture-set";
import {
  deriveFoliageEmbeddedMaterialImport,
  type GlbDocument
} from "./foliage-embedded-materials";

export * from "./pbr-texture-set";
export * from "./foliage-embedded-materials";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;

export interface ImportSourceAssetRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
}

export interface ImportSourceAssetResult {
  assetDefinition: AssetDefinition;
  textureDefinitions: TextureDefinition[];
  materialDefinitions: MaterialDefinition[];
  /** Plan 069.1 — the imported source bytes, handed back so the studio
   *  can bake the collider's `localBounds` in-memory (Box3.setFromObject)
   *  without re-reading the just-written file (the FSAccess read-after-
   *  write flake). Null for non-GLB imports. */
  sourceBuffer: ArrayBuffer | null;
  warnings: string[];
}

export interface ImportTextureDefinitionRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  defaultDisplayName?: string;
  packing?: TextureDefinition["packing"];
  colorSpace?: TextureDefinition["colorSpace"];
}

export interface ImportTextureDefinitionResult {
  textureDefinition: TextureDefinition;
}

export interface ImportCharacterModelDefinitionRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
  defaultDisplayName?: string;
}

export interface ImportCharacterModelDefinitionResult {
  characterModelDefinition: CharacterModelDefinition;
  warnings: string[];
}

export interface ImportCharacterAnimationDefinitionRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
  defaultDisplayName?: string;
}

export interface ImportCharacterAnimationDefinitionResult {
  characterAnimationDefinition: CharacterAnimationDefinition;
  warnings: string[];
}

export interface ImportAudioClipDefinitionRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  defaultDisplayName?: string;
}

export interface ImportAudioClipDefinitionResult {
  audioClipDefinition: AudioClipDefinition;
}

export interface ImportMaskTextureDefinitionRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  defaultDisplayName?: string;
  format?: MaskTextureDefinition["format"];
}

export interface ImportMaskTextureDefinitionResult {
  maskTextureDefinition: MaskTextureDefinition;
}

/**
 * Which built-in Standard PBR shader variant to bind the imported
 * material to. "orm" when the folder includes an ORM-packed texture
 * (one file encoding AO/roughness/metallic across R/G/B);
 * "separate" when the folder has dedicated roughness / metallic / ao
 * files instead. Selection is made based on which files were
 * actually discovered — authors don't have to pick.
 */
export type StandardPbrShaderVariant = "orm" | "separate";

export interface ImportPbrTextureSetResult {
  textures: TextureDefinition[];
  textureBindings: Partial<Record<StandardPbrTextureParameterId, string>>;
  /**
   * Which standard-pbr variant the imported bindings are intended
   * for. Callers use this to resolve the built-in shader by
   * `metadata.builtInKey`: "standard-pbr" for orm, "standard-pbr-
   * separate" for separate.
   */
  suggestedShaderVariant: StandardPbrShaderVariant;
  suggestedMaterialDisplayName: string;
  warnings: string[];
}

export interface SourceAssetAnalysis {
  assetKind: AssetDefinition["assetKind"];
  contract: "generic-model" | "foilagemaker-foliage";
  meshCount: number;
  animationClipNames: string[];
}

function sanitizeFileNameSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset"
  );
}

function getFileNameParts(fileName: string): { stem: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return { stem: fileName, ext: "" };
  }

  return {
    stem: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGlbJsonChunk(buffer: ArrayBuffer): GlbDocument | null {
  return readGlbChunks(buffer)?.document ?? null;
}

function readGlbChunks(
  buffer: ArrayBuffer
): { document: GlbDocument; binaryChunk: Uint8Array | null } | null {
  if (buffer.byteLength < 20) return null;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;

  const declaredLength = view.getUint32(8, true);
  const totalLength = Math.min(declaredLength, buffer.byteLength);
  let offset = 12;
  let document: GlbDocument | null = null;
  let binaryChunk: Uint8Array | null = null;

  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > totalLength) {
      return null;
    }

    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      const bytes = new Uint8Array(buffer, chunkStart, chunkLength);
      const rawText = new TextDecoder().decode(bytes);
      let end = rawText.length;
      while (end > 0 && rawText.charCodeAt(end - 1) === 0) {
        end -= 1;
      }
      const text = rawText.slice(0, end);
      try {
        document = JSON.parse(text) as GlbDocument;
      } catch {
        return null;
      }
    } else {
      binaryChunk = new Uint8Array(buffer, chunkStart, chunkLength);
    }

    offset = chunkEnd;
  }

  if (!document) {
    return null;
  }

  return { document, binaryChunk };
}

function getFoilageMakerExtras(
  document: GlbDocument
): Record<string, unknown> | null {
  for (const node of document.nodes ?? []) {
    if (!isRecord(node.extras)) continue;
    if (node.extras.foilagemaker_kind === "tree") {
      return node.extras;
    }
  }

  return null;
}

function collectPrimitiveAttributes(document: GlbDocument): Set<string> {
  const attributes = new Set<string>();

  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const attributeName of Object.keys(primitive.attributes ?? {})) {
        attributes.add(attributeName);
      }
    }
  }

  return attributes;
}

function hasEmbeddedTextureReference(document: GlbDocument): boolean {
  return (document.materials ?? []).some((material) => {
    const baseColorTexture =
      material.pbrMetallicRoughness?.baseColorTexture?.index;
    return (
      typeof baseColorTexture === "number" ||
      typeof material.normalTexture?.index === "number" ||
      typeof material.emissiveTexture?.index === "number"
    );
  });
}

function collectSurfaceSlots(
  document: GlbDocument
): AssetDefinition["surfaceSlots"] {
  return (document.materials ?? []).map((material, slotIndex) => {
    const rawName =
      typeof material.name === "string" && material.name.trim().length > 0
        ? material.name.trim()
        : `Material ${slotIndex + 1}`;
    return {
      slotName: rawName,
      slotIndex,
      surface: null
    };
  });
}

function collectAnimationClipNames(document: GlbDocument): string[] {
  return (document.animations ?? []).map((animation, index) => {
    const name = animation.name?.trim();
    return name && name.length > 0 ? name : `Clip ${index + 1}`;
  });
}

function countMeshes(document: GlbDocument): number {
  return document.meshes?.length ?? 0;
}

async function importTextureDefinitionFromFile(
  sourceFile: File,
  request: ImportTextureDefinitionRequest
): Promise<ImportTextureDefinitionResult> {
  const { stem, ext } = getFileNameParts(sourceFile.name);
  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `${request.descriptor.authoredAssetsPath}/textures/${targetFileName}`;

  await writeBlobFile(
    request.projectHandle,
    [request.descriptor.authoredAssetsPath, "textures", targetFileName],
    sourceFile
  );

  return {
    textureDefinition: {
      definitionId: `texture:${safeStem}`,
      definitionKind: "texture",
      displayName: request.defaultDisplayName ?? stem,
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      },
      packing: request.packing ?? "rgba",
      colorSpace: request.colorSpace ?? "srgb"
    }
  };
}

export async function importCharacterAnimationDefinitionFromFile(
  sourceFile: File,
  request: ImportCharacterAnimationDefinitionRequest
): Promise<ImportCharacterAnimationDefinitionResult> {
  const { stem, ext } = getFileNameParts(sourceFile.name);
  if (ext.toLowerCase() !== ".glb") {
    throw new Error(
      "Character animation imports currently accept GLB files only."
    );
  }

  const sourceBuffer = await sourceFile.arrayBuffer();
  const glbChunks = readGlbChunks(sourceBuffer);
  const clipNames = glbChunks
    ? collectAnimationClipNames(glbChunks.document)
    : [];
  if (clipNames.length === 0) {
    throw new Error("The selected GLB does not contain any animation clips.");
  }

  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `${request.descriptor.authoredAssetsPath}/character-animations/${targetFileName}`;

  await writeBlobFile(
    request.projectHandle,
    [
      request.descriptor.authoredAssetsPath,
      "character-animations",
      targetFileName
    ],
    sourceFile
  );

  return {
    characterAnimationDefinition: createDefaultCharacterAnimationDefinition(
      request.projectId,
      {
        definitionId: `${request.projectId}:character-animation:${safeStem}`,
        displayName: request.defaultDisplayName ?? stem,
        source: {
          relativeAssetPath,
          fileName: sourceFile.name,
          mimeType: sourceFile.type || null
        },
        clipNames
      }
    ),
    warnings: []
  };
}

export async function importCharacterModelDefinitionFromFile(
  sourceFile: File,
  request: ImportCharacterModelDefinitionRequest
): Promise<ImportCharacterModelDefinitionResult> {
  const { stem, ext } = getFileNameParts(sourceFile.name);
  if (ext.toLowerCase() !== ".glb") {
    throw new Error("Character model imports currently accept GLB files only.");
  }

  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `${request.descriptor.authoredAssetsPath}/character-models/${targetFileName}`;

  await writeBlobFile(
    request.projectHandle,
    [request.descriptor.authoredAssetsPath, "character-models", targetFileName],
    sourceFile
  );

  return {
    characterModelDefinition: createDefaultCharacterModelDefinition(
      request.projectId,
      {
        definitionId: `${request.projectId}:character-model:${safeStem}`,
        displayName: request.defaultDisplayName ?? stem,
        source: {
          relativeAssetPath,
          fileName: sourceFile.name,
          mimeType: sourceFile.type || null
        }
      }
    ),
    warnings: []
  };
}

async function importMaskTextureDefinitionFromFile(
  sourceFile: File,
  request: ImportMaskTextureDefinitionRequest
): Promise<ImportMaskTextureDefinitionResult> {
  const { stem, ext } = getFileNameParts(sourceFile.name);
  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `masks/${targetFileName}`;

  await writeBlobFile(
    request.projectHandle,
    ["masks", targetFileName],
    sourceFile
  );

  const bitmap = await createImageBitmap(sourceFile);
  const resolution: [number, number] = [bitmap.width, bitmap.height];
  bitmap.close();

  return {
    maskTextureDefinition: {
      definitionId: `mask-texture:${safeStem}`,
      definitionKind: "mask-texture",
      displayName: request.defaultDisplayName ?? stem,
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      },
      format: request.format ?? "r8",
      resolution
    }
  };
}

async function pickImageFile(): Promise<File> {
  const fileHandle = await pickFile({
    types: [
      {
        description: "Image Textures",
        accept: {
          "image/png": [".png"],
          "image/jpeg": [".jpg", ".jpeg"]
        }
      }
    ]
  });
  return fileHandle.getFile();
}

async function pickCharacterModelFile(): Promise<File> {
  const fileHandle = await pickFile({
    types: [
      {
        description: "Character Model GLB",
        accept: {
          "model/gltf-binary": [".glb"],
          "application/octet-stream": [".glb"]
        }
      }
    ]
  });
  return fileHandle.getFile();
}

async function pickCharacterAnimationFile(): Promise<File> {
  const fileHandle = await pickFile({
    types: [
      {
        description: "Character Animation GLB",
        accept: {
          "model/gltf-binary": [".glb"],
          "application/octet-stream": [".glb"]
        }
      }
    ]
  });
  return fileHandle.getFile();
}

async function pickAudioFile(): Promise<File> {
  const fileHandle = await pickFile({
    types: [
      {
        description: "Audio Clips",
        accept: {
          "audio/mpeg": [".mp3"],
          "audio/ogg": [".ogg"],
          "audio/wav": [".wav"],
          "audio/wave": [".wav"],
          "audio/x-wav": [".wav"]
        }
      }
    ]
  });
  return fileHandle.getFile();
}

function validateFoilageMakerFoliageDocument(
  document: GlbDocument,
  extras: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  if (!Array.isArray(document.meshes) || document.meshes.length === 0) {
    errors.push("missing mesh payloads");
  }

  if (!Array.isArray(document.materials) || document.materials.length === 0) {
    errors.push("missing material carriers");
  }

  if (!Array.isArray(document.images) || document.images.length === 0) {
    errors.push("missing embedded texture images");
  }

  if (!hasEmbeddedTextureReference(document)) {
    errors.push("missing material texture references");
  }

  const primitiveAttributes = collectPrimitiveAttributes(document);
  for (const attributeName of ["POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"]) {
    if (!primitiveAttributes.has(attributeName)) {
      errors.push(`missing ${attributeName} primitive attribute`);
    }
  }

  if (extras.foilagemaker_leaf_color_rgb !== "canopy_tint_gradient") {
    errors.push("missing canopy tint gradient metadata");
  }

  if (extras.foilagemaker_leaf_color_alpha !== "sun_exterior_bias") {
    errors.push("missing sun/exterior bias metadata");
  }

  if (extras.foilagemaker_uv_layer !== "UVMap") {
    errors.push("missing UVMap metadata");
  }

  return errors;
}

export async function analyzeSourceAssetFile(
  sourceFile: File
): Promise<SourceAssetAnalysis> {
  const { ext } = getFileNameParts(sourceFile.name);
  if (ext.toLowerCase() !== ".glb") {
    return {
      assetKind: "model",
      contract: "generic-model",
      meshCount: 0,
      animationClipNames: []
    };
  }

  const document = readGlbJsonChunk(await sourceFile.arrayBuffer());
  if (!document) {
    return {
      assetKind: "model",
      contract: "generic-model",
      meshCount: 0,
      animationClipNames: []
    };
  }

  const meshCount = countMeshes(document);
  const animationClipNames = collectAnimationClipNames(document);

  const foilageMakerExtras = getFoilageMakerExtras(document);
  if (!foilageMakerExtras) {
    return {
      assetKind: "model",
      contract: "generic-model",
      meshCount,
      animationClipNames
    };
  }

  const diagnostics = validateFoilageMakerFoliageDocument(
    document,
    foilageMakerExtras
  );
  if (diagnostics.length > 0) {
    throw new Error(
      `Invalid foliage GLB contract: ${diagnostics.join(", ")}. Re-export the tree from FoilageMaker with validation enabled.`
    );
  }

  return {
    assetKind: "foliage",
    contract: "foilagemaker-foliage",
    meshCount,
    animationClipNames
  };
}

export async function importTextureDefinition(
  request: ImportTextureDefinitionRequest
): Promise<ImportTextureDefinitionResult> {
  const sourceFile = await pickImageFile();
  return importTextureDefinitionFromFile(sourceFile, request);
}

export async function importMaskTextureDefinition(
  request: ImportMaskTextureDefinitionRequest
): Promise<ImportMaskTextureDefinitionResult> {
  const sourceFile = await pickImageFile();
  return importMaskTextureDefinitionFromFile(sourceFile, request);
}

export async function importCharacterModelDefinition(
  request: ImportCharacterModelDefinitionRequest
): Promise<ImportCharacterModelDefinitionResult> {
  const sourceFile = await pickCharacterModelFile();
  return importCharacterModelDefinitionFromFile(sourceFile, request);
}

export async function importCharacterAnimationDefinition(
  request: ImportCharacterAnimationDefinitionRequest
): Promise<ImportCharacterAnimationDefinitionResult> {
  const sourceFile = await pickCharacterAnimationFile();
  return importCharacterAnimationDefinitionFromFile(sourceFile, request);
}

export async function importAudioClipDefinitionFromFile(
  sourceFile: File,
  request: ImportAudioClipDefinitionRequest
): Promise<ImportAudioClipDefinitionResult> {
  const { stem, ext } = getFileNameParts(sourceFile.name);
  const lowerExt = ext.toLowerCase();
  if (![".mp3", ".ogg", ".wav"].includes(lowerExt)) {
    throw new Error("Audio imports accept MP3, OGG, or WAV files.");
  }

  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `${request.descriptor.authoredAssetsPath}/audio/${targetFileName}`;

  await writeBlobFile(
    request.projectHandle,
    [request.descriptor.authoredAssetsPath, "audio", targetFileName],
    sourceFile
  );

  return {
    audioClipDefinition: createDefaultAudioClipDefinition({
      displayName: request.defaultDisplayName ?? stem,
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      }
    })
  };
}

export async function importAudioClipDefinition(
  request: ImportAudioClipDefinitionRequest
): Promise<ImportAudioClipDefinitionResult> {
  const sourceFile = await pickAudioFile();
  return importAudioClipDefinitionFromFile(sourceFile, request);
}

export async function importPbrTextureSet(
  request: ImportTextureDefinitionRequest
): Promise<ImportPbrTextureSetResult> {
  const sourceDirectory = await pickDirectory();
  const sourceFiles = await listFilesInDirectory(sourceDirectory, {
    extensions: [".png", ".jpg", ".jpeg"]
  });
  const discoveredSet = discoverPbrTextureSet(sourceFiles);
  const textures: TextureDefinition[] = [];
  const textureBindings: Partial<
    Record<StandardPbrTextureParameterId, string>
  > = {};

  for (const [role, sourceFile] of Object.entries(
    discoveredSet.filesByRole
  ) as Array<[PbrTextureRole, File]>) {
    const parameterId = materialParameterIdForPbrTextureRole(role);
    const imported = (
      await importTextureDefinitionFromFile(sourceFile, {
        ...request,
        defaultDisplayName: `${request.defaultDisplayName ?? getFileNameParts(sourceFile.name).stem} ${labelForPbrTextureRole(role)}`,
        packing: packingForPbrTextureRole(role),
        colorSpace: colorSpaceForPbrTextureRole(role)
      })
    ).textureDefinition;
    textures.push(imported);
    if (parameterId) {
      textureBindings[parameterId] = imported.definitionId;
    }
  }

  // Decide which standard-pbr variant to bind. ORM wins when the
  // import contains a packed ORM file — it's a strong signal the
  // author already packed for efficiency and the Material should
  // sample the packed version. Otherwise, when any of the separate
  // channels arrived (roughness / metallic / ao), bind to the
  // separate variant. The no-scalar case (just basecolor + normal)
  // is bound to ORM as a conservative default since it costs one
  // less sample and either variant would render the same scalar
  // defaults anyway.
  const hasOrm = Boolean(textureBindings.orm_texture);
  const hasAnySeparateChannel = Boolean(
    textureBindings.roughness_texture ||
    textureBindings.metallic_texture ||
    textureBindings.ao_texture
  );
  const suggestedShaderVariant: StandardPbrShaderVariant = hasOrm
    ? "orm"
    : hasAnySeparateChannel
      ? "separate"
      : "orm";

  return {
    textures,
    textureBindings,
    suggestedShaderVariant,
    suggestedMaterialDisplayName:
      request.defaultDisplayName ?? discoveredSet.suggestedMaterialDisplayName,
    warnings: discoveredSet.warnings
  };
}

export async function importSourceAsset(
  request: ImportSourceAssetRequest
): Promise<ImportSourceAssetResult> {
  const fileHandle = await pickFile({
    types: [
      {
        description: "3D Assets",
        accept: {
          "model/gltf-binary": [".glb"],
          "model/gltf+json": [".gltf"],
          "application/octet-stream": [".glb"]
        }
      }
    ]
  });
  const sourceFile = await fileHandle.getFile();
  const analysis = await analyzeSourceAssetFile(sourceFile);
  const { stem, ext } = getFileNameParts(sourceFile.name);
  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `${request.descriptor.authoredAssetsPath}/imported/${targetFileName}`;
  const sourceBuffer = await sourceFile.arrayBuffer();
  const glbChunks =
    ext.toLowerCase() === ".glb" ? readGlbChunks(sourceBuffer) : null;

  await writeBlobFile(
    request.projectHandle,
    [request.descriptor.authoredAssetsPath, "imported", targetFileName],
    sourceFile
  );

  const embeddedFoliageImport =
    analysis.contract === "foilagemaker-foliage" && glbChunks
      ? deriveFoliageEmbeddedMaterialImport({
          assetStem: safeStem,
          assetDisplayName: stem,
          authoredAssetsPath: request.descriptor.authoredAssetsPath,
          document: glbChunks.document,
          binaryChunk: glbChunks.binaryChunk
        })
      : {
          textureDefinitions: [],
          materialDefinitions: [],
          surfaceSlots:
            ext.toLowerCase() === ".glb"
              ? collectSurfaceSlots(glbChunks?.document ?? {})
              : [],
          files: [],
          warnings: []
        };

  for (const file of embeddedFoliageImport.files) {
    await writeBlobFile(request.projectHandle, file.pathSegments, file.blob);
  }

  const warnings = [...embeddedFoliageImport.warnings];
  if (
    ext.toLowerCase() === ".glb" &&
    analysis.meshCount === 0 &&
    analysis.animationClipNames.length > 0
  ) {
    warnings.push(
      "This GLB contains animation clips but no meshes. Did you mean to import it as a character animation? Open the Player or NPC inspector and use Import Animation… on a slot."
    );
  }

  return {
    assetDefinition: {
      definitionId: `asset:${safeStem}`,
      definitionKind: "asset",
      displayName: stem,
      assetKind: analysis.assetKind,
      surfaceSlots: embeddedFoliageImport.surfaceSlots,
      deform: null,
      effect: null,
      // Plan 069.1 — kind-aware collider SHAPE at import (foliage -> none,
      // model -> auto-box); the studio fills localBounds from sourceBuffer.
      collider: defaultAssetColliderForKind(analysis.assetKind),
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      }
    },
    textureDefinitions: embeddedFoliageImport.textureDefinitions,
    materialDefinitions: embeddedFoliageImport.materialDefinitions,
    sourceBuffer: ext.toLowerCase() === ".glb" ? sourceBuffer : null,
    warnings
  };
}

// ---- Animation library import ----------------------------------------

export interface ImportAnimationLibraryRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
}

export interface ImportAnimationLibraryResult {
  definitions: AnimationLibraryDefinition[];
  writtenAssets: Array<{ relativeAssetPath: string; blob: Blob }>;
  warnings: string[];
}

const STANDARD_RIG_BONE_SET = new Set<string>(STANDARD_RIG_CORE_BONE_NAMES);

/**
 * Extract one animation from a full GLB (which may carry meshes,
 * materials, images from a Blender export) and return a clean GLB
 * containing only the node hierarchy + that one animation track.
 *
 * The binary chunk is compacted to only the accessors the animation
 * actually references. Nodes keep their parent-child hierarchy but
 * shed mesh and skin references (they aren't needed for playback).
 */
function stripToSkeletonAnimation(
  document: GltfJson,
  binaryChunk: Uint8Array,
  animIndex: number
): ArrayBuffer {
  const anim = document.animations![animIndex]!;

  // Collect accessor indices referenced by this animation's samplers.
  const usedAccessorIndices = new Set<number>();
  for (const sampler of anim.samplers) {
    usedAccessorIndices.add(sampler.input);
    usedAccessorIndices.add(sampler.output);
  }

  // Collect bufferView indices used by those accessors.
  const usedBufferViewIndices = new Set<number>();
  for (const accIdx of usedAccessorIndices) {
    const acc = document.accessors?.[accIdx];
    if (acc?.bufferView !== undefined) usedBufferViewIndices.add(acc.bufferView);
  }

  // Build compact binary: copy each used bufferView's bytes (4-aligned).
  const oldBinBase = binaryChunk.byteOffset;
  const fullBuffer = binaryChunk.buffer;
  const newByteOffsets = new Map<number, number>();
  const parts: Uint8Array[] = [];
  let compactedLength = 0;
  for (const bvIdx of [...usedBufferViewIndices].sort((a, b) => a - b)) {
    const bv = document.bufferViews?.[bvIdx];
    if (!bv) continue;
    const pad = (4 - (compactedLength % 4)) % 4;
    if (pad > 0) {
      parts.push(new Uint8Array(pad));
      compactedLength += pad;
    }
    newByteOffsets.set(bvIdx, compactedLength);
    const src = new Uint8Array(
      fullBuffer,
      oldBinBase + (bv.byteOffset ?? 0),
      bv.byteLength ?? 0
    );
    parts.push(src);
    compactedLength += src.byteLength;
  }
  const compactedBin = new Uint8Array(compactedLength);
  let off = 0;
  for (const part of parts) {
    compactedBin.set(part, off);
    off += part.byteLength;
  }

  // Remap bufferView indices -> compact indices.
  const bvOldToNew = new Map<number, number>();
  const newBufferViews: GltfJson["bufferViews"] = [];
  for (const bvIdx of [...usedBufferViewIndices].sort((a, b) => a - b)) {
    const bv = document.bufferViews?.[bvIdx];
    if (!bv) continue;
    bvOldToNew.set(bvIdx, newBufferViews.length);
    newBufferViews.push({
      buffer: 0,
      byteOffset: newByteOffsets.get(bvIdx) ?? 0,
      byteLength: bv.byteLength ?? 0
    });
  }

  // Remap accessor indices -> compact indices.
  const accOldToNew = new Map<number, number>();
  const newAccessors: GltfJson["accessors"] = [];
  for (const accIdx of [...usedAccessorIndices].sort((a, b) => a - b)) {
    const acc = document.accessors?.[accIdx];
    if (!acc) continue;
    accOldToNew.set(accIdx, newAccessors.length);
    newAccessors.push({
      ...acc,
      bufferView:
        acc.bufferView !== undefined
          ? (bvOldToNew.get(acc.bufferView) ?? acc.bufferView)
          : undefined
    });
  }

  // Rebuild animation with remapped sampler indices.
  const newAnim = {
    name: anim.name,
    channels: anim.channels.map((ch) => ({ ...ch })),
    samplers: anim.samplers.map((s) => ({
      ...s,
      input: accOldToNew.get(s.input) ?? s.input,
      output: accOldToNew.get(s.output) ?? s.output
    }))
  };

  // Clean nodes: strip mesh + skin references.
  const cleanNodes: GltfJson["nodes"] = (document.nodes ?? []).map((node) => {
    const { mesh: _mesh, skin: _skin, ...rest } = node as typeof node & {
      mesh?: unknown;
      skin?: unknown;
    };
    void _mesh;
    void _skin;
    return rest;
  });

  const outDocument: GltfJson = {
    asset: { version: "2.0", generator: "sugarmagic" },
    scene: 0,
    scenes: [{ nodes: document.scenes?.[document.scene ?? 0]?.nodes ?? [] }],
    nodes: cleanNodes,
    animations: [newAnim] as GltfJson["animations"],
    accessors: newAccessors,
    bufferViews: newBufferViews,
    buffers: [{ byteLength: compactedLength }]
  };

  return packGlb(outDocument, compactedBin);
}

/**
 * Import a Blender GLB file as one or more animation library entries.
 *
 * Accepts Blender export quirks: dotted bone names (DEF-spine.001),
 * extra non-bone nodes, meshes + materials included in the export
 * (stripped in the re-emit). One library entry per animation action
 * found in the file, named from the action.
 *
 * Validates that at least one animation channel targets a standard-rig
 * bone name. Rejects with an actionable error if none match.
 *
 * Writes each stripped GLB to assets/animations/ and returns the
 * in-memory blobs so callers can publishAssetSource without re-reading
 * from disk (avoids the FSAccess read-after-write flake).
 */
export async function importAnimationLibraryFromGlbFile(
  sourceFile: File,
  request: ImportAnimationLibraryRequest
): Promise<ImportAnimationLibraryResult> {
  const { stem, ext } = getFileNameParts(sourceFile.name);
  if (ext.toLowerCase() !== ".glb") {
    throw new Error("Animation library imports accept GLB files only.");
  }

  const sourceBuffer = await sourceFile.arrayBuffer();
  const chunks = readGlbFull(sourceBuffer);
  if (!chunks) {
    throw new Error("The selected file is not a valid GLB.");
  }
  const { document, binaryChunk } = chunks;

  const animations = document.animations ?? [];
  if (animations.length === 0) {
    throw new Error("The selected GLB does not contain any animation clips.");
  }

  // Build a map of node index -> node name for bone validation.
  const nodeNames = new Map<number, string>();
  (document.nodes ?? []).forEach((node, index) => {
    if (node.name) nodeNames.set(index, node.name);
  });

  // Validate: at least one channel in any animation targets a standard-rig bone.
  let foundAnyRigBone = false;
  const encounteredBoneNames = new Set<string>();
  for (const anim of animations) {
    for (const ch of anim.channels) {
      const nodeName =
        ch.target.node !== undefined ? nodeNames.get(ch.target.node) : undefined;
      if (nodeName) {
        encounteredBoneNames.add(nodeName);
        if (STANDARD_RIG_BONE_SET.has(nodeName)) foundAnyRigBone = true;
      }
    }
  }
  if (!foundAnyRigBone) {
    const found = [...encounteredBoneNames].slice(0, 5).join(", ");
    throw new Error(
      `No standard-rig bones found in animation tracks.` +
        ` Expected names like "DEF-hips", "DEF-spine.001", "DEF-head".` +
        (found ? ` Encountered: ${found}.` : "") +
        ` Export from the standard maquette GLB or rename bones to match the contract.`
    );
  }

  const safeStem = sanitizeFileNameSegment(stem);
  const definitions: AnimationLibraryDefinition[] = [];
  const writtenAssets: Array<{ relativeAssetPath: string; blob: Blob }> = [];
  const warnings: string[] = [];
  const assetsDir = request.descriptor.authoredAssetsPath;

  for (let i = 0; i < animations.length; i += 1) {
    const anim = animations[i]!;
    const rawName = anim.name?.trim();
    const clipName =
      rawName && rawName.length > 0 ? rawName : `Clip ${i + 1}`;
    const safeClip = sanitizeFileNameSegment(clipName);
    const fileName = `${safeStem}-${safeClip}.glb`;
    const relativeAssetPath = `${assetsDir}/animations/${fileName}`;

    let strippedBuffer: ArrayBuffer;
    try {
      strippedBuffer = binaryChunk
        ? stripToSkeletonAnimation(document, binaryChunk, i)
        : sourceBuffer;
    } catch (err) {
      warnings.push(
        `Clip "${clipName}": strip failed (${err instanceof Error ? err.message : String(err)}); writing source bytes.`
      );
      strippedBuffer = sourceBuffer;
    }

    const blob = new Blob([strippedBuffer], { type: "model/gltf-binary" });
    await writeBlobFile(
      request.projectHandle,
      [assetsDir, "animations", fileName],
      blob
    );
    writtenAssets.push({ relativeAssetPath, blob });

    const definitionId = `${request.projectId}:animation-library:${safeStem}-${safeClip}`;
    definitions.push(
      createDefaultAnimationLibraryDefinition(request.projectId, {
        definitionId,
        displayName: clipName,
        origin: "imported",
        source: { relativeAssetPath, fileName, mimeType: "model/gltf-binary" },
        clipNames: [clipName]
      })
    );
  }

  return { definitions, writtenAssets, warnings };
}
