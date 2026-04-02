import type {
  GameProject,
  RegionDocument,
  ContentLibrarySnapshot
} from "@sugarmagic/domain";

export type PersistencePayloadKind =
  | "canonical-authored"
  | "authoring-sidecar"
  | "derived-runtime"
  | "publish-artifact";

export interface DocumentLoadResult {
  gameProject: GameProject | null;
  contentLibrary: ContentLibrarySnapshot | null;
  regions: RegionDocument[];
}

export interface CanonicalDocumentIo {
  loadGameProject: (rootPath: string) => Promise<DocumentLoadResult>;
  saveGameProject: (rootPath: string, project: GameProject) => Promise<void>;
}
