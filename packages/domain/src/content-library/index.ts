import type { DocumentIdentity } from "../shared/identity";

export type ContentDefinitionKind =
  | "asset"
  | "material"
  | "npc"
  | "dialogue"
  | "quest"
  | "item"
  | "inspection"
  | "resonance-point"
  | "vfx";

export interface ContentDefinitionReference {
  definitionId: string;
  definitionKind: ContentDefinitionKind;
}

export interface AssetDefinition {
  definitionId: string;
  definitionKind: "asset";
  displayName: string;
  assetKind: "model";
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
}

export interface ContentLibrarySnapshot {
  identity: DocumentIdentity;
  assetDefinitions: AssetDefinition[];
}

export function createEmptyContentLibrarySnapshot(
  projectId: string
): ContentLibrarySnapshot {
  return {
    identity: {
      id: `${projectId}:content-library`,
      schema: "ContentLibrary",
      version: 1
    },
    assetDefinitions: []
  };
}

export function getAssetDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): AssetDefinition | null {
  return (
    contentLibrary.assetDefinitions.find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listAssetDefinitions(
  contentLibrary: ContentLibrarySnapshot
): AssetDefinition[] {
  return [...contentLibrary.assetDefinitions];
}
