/**
 * Source-asset import boundary for the project content library.
 *
 * IO owns file picking, asset copying into the game root, and import-time GLB
 * contract validation. Domain meaning stays small here: this layer can
 * distinguish generic model assets from foliage assets, but it does not invent
 * runtime foliage behavior or editor-owned sidecar metadata.
 */

import {
  createDefaultCharacterAnimationDefinition,
  createDefaultCharacterModelDefinition,
  type AssetDefinition,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition,
  type MaterialDefinition,
  type MaskTextureDefinition,
  type TextureDefinition
} from "@sugarmagic/domain";
import { listFilesInDirectory, pickDirectory, pickFile, writeBlobFile } from "../fs-access";
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

function getFoilageMakerExtras(document: GlbDocument): Record<string, unknown> | null {
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
    const baseColorTexture = material.pbrMetallicRoughness?.baseColorTexture?.index;
    return (
      typeof baseColorTexture === "number" ||
      typeof material.normalTexture?.index === "number" ||
      typeof material.emissiveTexture?.index === "number"
    );
  });
}

function collectSurfaceSlots(document: GlbDocument): AssetDefinition["surfaceSlots"] {
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
  const clipNames = glbChunks ? collectAnimationClipNames(glbChunks.document) : [];
  if (clipNames.length === 0) {
    throw new Error("The selected GLB does not contain any animation clips.");
  }

  const safeStem = sanitizeFileNameSegment(stem);
  const targetFileName = `${safeStem}${ext}`;
  const relativeAssetPath = `${request.descriptor.authoredAssetsPath}/character-animations/${targetFileName}`;

  await writeBlobFile(
    request.projectHandle,
    [request.descriptor.authoredAssetsPath, "character-animations", targetFileName],
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

  await writeBlobFile(request.projectHandle, ["masks", targetFileName], sourceFile);

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

export async function importPbrTextureSet(
  request: ImportTextureDefinitionRequest
): Promise<ImportPbrTextureSetResult> {
  const sourceDirectory = await pickDirectory();
  const sourceFiles = await listFilesInDirectory(sourceDirectory, {
    extensions: [".png", ".jpg", ".jpeg"]
  });
  const discoveredSet = discoverPbrTextureSet(sourceFiles);
  const textures: TextureDefinition[] = [];
  const textureBindings: Partial<Record<StandardPbrTextureParameterId, string>> = {};

  for (const [role, sourceFile] of Object.entries(discoveredSet.filesByRole) as Array<
    [PbrTextureRole, File]
  >) {
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
  const suggestedShaderVariant: StandardPbrShaderVariant =
    hasOrm ? "orm" : hasAnySeparateChannel ? "separate" : "orm";

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
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      }
    },
    textureDefinitions: embeddedFoliageImport.textureDefinitions,
    materialDefinitions: embeddedFoliageImport.materialDefinitions,
    warnings
  };
}
