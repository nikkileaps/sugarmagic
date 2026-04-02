import type { AssetDefinition } from "@sugarmagic/domain";
import { writeBlobFile, pickFile } from "../fs-access";
import type { GameRootDescriptor } from "../game-root";

export interface ImportSourceAssetRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
}

export interface ImportSourceAssetResult {
  assetDefinition: AssetDefinition;
}

function sanitizeFileNameSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
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
      assetKind: "model",
      source: {
        relativeAssetPath,
        fileName: sourceFile.name,
        mimeType: sourceFile.type || null
      }
    }
  };
}
