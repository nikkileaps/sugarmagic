import type {
  ContentLibrarySnapshot,
  RegionDocument,
  TimestampIso
} from "@sugarmagic/domain";
import { getEnvironmentDefinition } from "@sugarmagic/domain";

export type RuntimeSessionBoundary = "isolated-runtime-session";
export type RuntimeSessionKind = "preview" | "playtest" | "published";

export interface RuntimeSessionSnapshot {
  workspaceId: string;
  cameraId: string;
}

export interface RuntimeSessionRecord {
  sessionId: string;
  sessionKind: RuntimeSessionKind;
  boundary: RuntimeSessionBoundary;
  createdAt: TimestampIso;
}

export interface RuntimeEnvironmentState {
  activeEnvironmentId: string | null;
}

export function resolveInitialRuntimeEnvironmentId(options: {
  region: RegionDocument | null;
  contentLibrary: ContentLibrarySnapshot;
  explicitEnvironmentId?: string | null;
}): string | null {
  const { region, contentLibrary, explicitEnvironmentId = null } = options;

  if (
    explicitEnvironmentId &&
    getEnvironmentDefinition(contentLibrary, explicitEnvironmentId)
  ) {
    return explicitEnvironmentId;
  }

  const regionBoundEnvironmentId = region?.environmentBinding.defaultEnvironmentId ?? null;
  if (
    regionBoundEnvironmentId &&
    getEnvironmentDefinition(contentLibrary, regionBoundEnvironmentId)
  ) {
    return regionBoundEnvironmentId;
  }

  return contentLibrary.environmentDefinitions[0]?.definitionId ?? null;
}

export function createRuntimeEnvironmentState(options: {
  region: RegionDocument | null;
  contentLibrary: ContentLibrarySnapshot;
  explicitEnvironmentId?: string | null;
}): RuntimeEnvironmentState {
  return {
    activeEnvironmentId: resolveInitialRuntimeEnvironmentId(options)
  };
}

export * from "./blackboard";
