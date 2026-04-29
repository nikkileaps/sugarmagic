/**
 * FoliageMaker embedded-material import helpers.
 *
 * FoliageMaker GLBs authored in Blender carry leaf/trunk textures inside the
 * GLB material carriers. Sugarmagic's long-term material system wants those
 * textures and materials to become explicit content-library truth at import
 * time, not to leak through runtime carrier-material fallbacks.
 *
 * This module owns the one-way conversion from embedded GLB texture payloads
 * into authored TextureDefinition + MaterialDefinition records plus the asset's
 * initial material-slot bindings.
 */

import type {
  AssetSurfaceSlot,
  MaterialDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import {
  createDefaultMaterialPbr,
  createInlineSurfaceBindingFromAppearance,
  createMaterialSurface
} from "@sugarmagic/domain";

export interface GlbNodeDocument {
  extras?: Record<string, unknown>;
}

export interface GlbPrimitiveDocument {
  attributes?: Record<string, unknown>;
}

export interface GlbMeshDocument {
  primitives?: GlbPrimitiveDocument[];
}

export interface GlbTextureInfoDocument {
  index?: number;
}

export interface GlbMaterialDocument {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorTexture?: GlbTextureInfoDocument;
  };
  normalTexture?: {
    index?: number;
  };
  emissiveTexture?: {
    index?: number;
  };
}

export interface GlbTextureDocument {
  source?: number;
}

export interface GlbImageDocument {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
  name?: string;
}

export interface GlbBufferViewDocument {
  byteOffset?: number;
  byteLength?: number;
}

export interface GlbAnimationDocument {
  name?: string;
}

export interface GlbDocument {
  nodes?: GlbNodeDocument[];
  meshes?: GlbMeshDocument[];
  animations?: GlbAnimationDocument[];
  materials?: GlbMaterialDocument[];
  images?: GlbImageDocument[];
  textures?: GlbTextureDocument[];
  bufferViews?: GlbBufferViewDocument[];
}

export interface DerivedImportedFile {
  pathSegments: string[];
  blob: Blob;
}

export interface DerivedFoliageEmbeddedMaterialImport {
  textureDefinitions: TextureDefinition[];
  materialDefinitions: MaterialDefinition[];
  surfaceSlots: AssetSurfaceSlot[];
  files: DerivedImportedFile[];
  warnings: string[];
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

function fileExtensionForMimeType(mimeType: string | null | undefined): string {
  switch (mimeType?.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/png":
    default:
      return ".png";
  }
}

function parseDataUri(dataUri: string): { blob: Blob; mimeType: string | null } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/u.exec(dataUri);
  if (!match) {
    throw new Error("Embedded GLB image uses an invalid data URI.");
  }
  const mimeType = match[1] ?? null;
  const payload = match[2] ?? "";
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: mimeType ?? "application/octet-stream" }),
    mimeType
  };
}

function extractEmbeddedImageBlob(
  document: GlbDocument,
  imageIndex: number,
  binaryChunk: Uint8Array | null
): { blob: Blob; mimeType: string | null; imageName: string | null } {
  const image = document.images?.[imageIndex] ?? null;
  if (!image) {
    throw new Error(`GLB references missing image index ${imageIndex}.`);
  }

  if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
    const parsed = parseDataUri(image.uri);
    return {
      blob: parsed.blob,
      mimeType: image.mimeType ?? parsed.mimeType,
      imageName: typeof image.name === "string" ? image.name : null
    };
  }

  if (typeof image.bufferView === "number") {
    if (!binaryChunk) {
      throw new Error("GLB image references a bufferView but the binary chunk is missing.");
    }
    const bufferView = document.bufferViews?.[image.bufferView] ?? null;
    if (!bufferView || typeof bufferView.byteLength !== "number") {
      throw new Error(`GLB image bufferView ${image.bufferView} is missing byteLength metadata.`);
    }
    const byteOffset = typeof bufferView.byteOffset === "number" ? bufferView.byteOffset : 0;
    const byteEnd = byteOffset + bufferView.byteLength;
    if (byteOffset < 0 || byteEnd > binaryChunk.byteLength) {
      throw new Error(`GLB image bufferView ${image.bufferView} points outside the binary chunk.`);
    }
    return {
      blob: new Blob([binaryChunk.slice(byteOffset, byteEnd)], {
        type: image.mimeType ?? "application/octet-stream"
      }),
      mimeType: image.mimeType ?? null,
      imageName: typeof image.name === "string" ? image.name : null
    };
  }

  throw new Error(
    `GLB image ${imageIndex} is unsupported. Expected a data URI or bufferView-backed image.`
  );
}

function slotNameForMaterial(material: GlbMaterialDocument, slotIndex: number): string {
  return typeof material.name === "string" && material.name.trim().length > 0
    ? material.name.trim()
    : `Material ${slotIndex + 1}`;
}

export function deriveFoliageEmbeddedMaterialImport(options: {
  assetStem: string;
  assetDisplayName: string;
  authoredAssetsPath: string;
  document: GlbDocument;
  binaryChunk: Uint8Array | null;
}): DerivedFoliageEmbeddedMaterialImport {
  const {
    assetStem,
    assetDisplayName,
    authoredAssetsPath,
    document,
    binaryChunk
  } = options;

  const textureDefinitions: TextureDefinition[] = [];
  const materialDefinitions: MaterialDefinition[] = [];
  const surfaceSlots: AssetSurfaceSlot[] = [];
  const files: DerivedImportedFile[] = [];
  const warnings: string[] = [];
  const textureDefinitionIdByImageIndex = new Map<number, string>();

  for (const [slotIndex, material] of (document.materials ?? []).entries()) {
    const slotName = slotNameForMaterial(material, slotIndex);
    const slotSlug = sanitizeFileNameSegment(slotName);
    const baseColorTextureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
    if (typeof baseColorTextureIndex !== "number") {
      warnings.push(
        `Material slot "${slotName}" has no embedded base-color texture, so no default material was created.`
      );
      surfaceSlots.push({
        slotName,
        slotIndex,
        surface: null
      });
      continue;
    }

    const imageIndex = document.textures?.[baseColorTextureIndex]?.source;
    if (typeof imageIndex !== "number") {
      warnings.push(
        `Material slot "${slotName}" references texture ${baseColorTextureIndex}, but that texture has no image source.`
      );
      surfaceSlots.push({
        slotName,
        slotIndex,
        surface: null
      });
      continue;
    }

    let textureDefinitionId = textureDefinitionIdByImageIndex.get(imageIndex) ?? null;
    if (!textureDefinitionId) {
      const extracted = extractEmbeddedImageBlob(document, imageIndex, binaryChunk);
      const extension = fileExtensionForMimeType(extracted.mimeType);
      const imageStem =
        extracted.imageName && extracted.imageName.trim().length > 0
          ? sanitizeFileNameSegment(extracted.imageName.replace(/\.[^.]+$/u, ""))
          : `${assetStem}-image-${imageIndex + 1}`;
      const fileName = `${imageStem}${extension}`;
      const relativeAssetPath = `${authoredAssetsPath}/textures/${fileName}`;
      textureDefinitionId = `texture:${assetStem}:image-${imageIndex + 1}`;
      textureDefinitionIdByImageIndex.set(imageIndex, textureDefinitionId);
      files.push({
        pathSegments: [authoredAssetsPath, "textures", fileName],
        blob: extracted.blob
      });
      textureDefinitions.push({
        definitionId: textureDefinitionId,
        definitionKind: "texture",
        displayName: `${assetDisplayName} ${slotName} Base Color`,
        source: {
          relativeAssetPath,
          fileName,
          mimeType: extracted.mimeType
        },
        colorSpace: "srgb",
        packing: "rgba"
      });
    }

    const materialDefinitionId = `material:${assetStem}:${slotSlug}:${slotIndex}`;
    materialDefinitions.push({
      definitionId: materialDefinitionId,
      definitionKind: "material",
      displayName: `${assetDisplayName} ${slotName}`,
      pbr: createDefaultMaterialPbr({
        baseColorMap: textureDefinitionId
      }),
      shaderDefinitionId: null
    });
    surfaceSlots.push({
      slotName,
      slotIndex,
      surface: createInlineSurfaceBindingFromAppearance(
        createMaterialSurface(materialDefinitionId)
      )
    });
  }

  return {
    textureDefinitions,
    materialDefinitions,
    surfaceSlots,
    files,
    warnings
  };
}
