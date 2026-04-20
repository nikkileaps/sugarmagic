/**
 * Source-asset import boundary for the project content library.
 *
 * IO owns file picking, asset copying into the game root, and import-time GLB
 * contract validation. Domain meaning stays small here: this layer can
 * distinguish generic model assets from foliage assets, but it does not invent
 * runtime foliage behavior or editor-owned sidecar metadata.
 */

import type {
  AssetDefinition,
  MaterialSlotBinding,
  TextureDefinition
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

export * from "./pbr-texture-set";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;

interface GlbNodeDocument {
  extras?: Record<string, unknown>;
}

interface GlbPrimitiveDocument {
  attributes?: Record<string, unknown>;
}

interface GlbMeshDocument {
  primitives?: GlbPrimitiveDocument[];
}

interface GlbMaterialDocument {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorTexture?: {
      index?: number;
    };
  };
  normalTexture?: {
    index?: number;
  };
  emissiveTexture?: {
    index?: number;
  };
}

interface GlbDocument {
  nodes?: GlbNodeDocument[];
  meshes?: GlbMeshDocument[];
  materials?: GlbMaterialDocument[];
  images?: unknown[];
  textures?: unknown[];
}

export interface ImportSourceAssetRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
}

export interface ImportSourceAssetResult {
  assetDefinition: AssetDefinition;
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

export interface ImportPbrTextureSetResult {
  textures: TextureDefinition[];
  textureBindings: Partial<Record<StandardPbrTextureParameterId, string>>;
  suggestedMaterialDisplayName: string;
  warnings: string[];
}

export interface SourceAssetAnalysis {
  assetKind: AssetDefinition["assetKind"];
  contract: "generic-model" | "foilagemaker-foliage";
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
  if (buffer.byteLength < 20) return null;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;

  const declaredLength = view.getUint32(8, true);
  const totalLength = Math.min(declaredLength, buffer.byteLength);
  let offset = 12;

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
      const text = new TextDecoder().decode(bytes).replace(/\u0000+$/u, "");
      try {
        return JSON.parse(text) as GlbDocument;
      } catch {
        return null;
      }
    }

    offset = chunkEnd;
  }

  return null;
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

function collectMaterialSlotBindings(document: GlbDocument): MaterialSlotBinding[] {
  return (document.materials ?? []).map((material, slotIndex) => {
    const rawName =
      typeof material.name === "string" && material.name.trim().length > 0
        ? material.name.trim()
        : `Material ${slotIndex + 1}`;
    return {
      slotName: rawName,
      slotIndex,
      materialDefinitionId: null
    };
  });
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
      contract: "generic-model"
    };
  }

  const document = readGlbJsonChunk(await sourceFile.arrayBuffer());
  if (!document) {
    return {
      assetKind: "model",
      contract: "generic-model"
    };
  }

  const foilageMakerExtras = getFoilageMakerExtras(document);
  if (!foilageMakerExtras) {
    return {
      assetKind: "model",
      contract: "generic-model"
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
    contract: "foilagemaker-foliage"
  };
}

export async function importTextureDefinition(
  request: ImportTextureDefinitionRequest
): Promise<ImportTextureDefinitionResult> {
  const sourceFile = await pickImageFile();
  return importTextureDefinitionFromFile(sourceFile, request);
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

  return {
    textures,
    textureBindings,
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

  await writeBlobFile(
    request.projectHandle,
    [request.descriptor.authoredAssetsPath, "imported", targetFileName],
    sourceFile
  );

  return {
    assetDefinition: {
      definitionId: `asset:${safeStem}`,
      definitionKind: "asset",
      displayName: stem,
      assetKind: analysis.assetKind,
      materialSlotBindings:
        ext.toLowerCase() === ".glb"
          ? collectMaterialSlotBindings(
              readGlbJsonChunk(await sourceFile.arrayBuffer()) ?? {}
            )
          : [],
      defaultShaderDefinitionId: null,
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      }
    }
  };
}
