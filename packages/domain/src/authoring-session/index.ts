/**
 * Authoring session: the canonical owner of in-memory authored documents.
 *
 * This is NOT a zustand store. It is a plain domain-owned container
 * for canonical authored truth, mutation history, and undo/redo.
 * Shell orchestration coordinates access to this session but does
 * not replace it as the source of truth.
 */

import type { GameProject } from "../game-project";
import type { RegionDocument } from "../region-authoring";
import {
  createDefaultRegionLandscapeState,
  createDefaultRegionLandscapeChannels
} from "../region-authoring";
import type { AuthoringHistory } from "../history";
import type { SemanticCommand, UpdateEnvironmentDefinitionCommand } from "../commands";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  EnvironmentDefinition
} from "../content-library";
import type { TimestampIso } from "../shared";
import {
  createEmptyContentLibrarySnapshot,
  listAssetDefinitions as listAssetDefinitionsFromLibrary,
  listEnvironmentDefinitions as listEnvironmentDefinitionsFromLibrary,
  normalizeContentLibrarySnapshot
} from "../content-library";
import { createScopedId } from "../shared";
import { executeCommand, pushTransaction } from "../commands/executor";
import { createEmptyHistory } from "../commands/executor";

interface SessionCheckpoint {
  contentLibrary: ContentLibrarySnapshot;
  regions: Map<string, RegionDocument>;
  activeRegionId: string | null;
}

export interface AuthoringSession {
  gameProject: GameProject;
  contentLibrary: ContentLibrarySnapshot;
  regions: Map<string, RegionDocument>;
  activeRegionId: string | null;
  undoStack: SessionCheckpoint[];
  redoStack: SessionCheckpoint[];
  history: AuthoringHistory;
  isDirty: boolean;
}

function defaultEnvironmentId(contentLibrary: ContentLibrarySnapshot): string | null {
  return contentLibrary.environmentDefinitions[0]?.definitionId ?? null;
}

function normalizeRegionDocument(
  region: RegionDocument,
  contentLibrary: ContentLibrarySnapshot
): RegionDocument {
  const legacyLandscape = (region as RegionDocument & {
    landscape?: Partial<ReturnType<typeof createDefaultRegionLandscapeState>> & {
      baseColor?: number;
    };
  }).landscape;
  const defaultLandscape = createDefaultRegionLandscapeState({
    channels: createDefaultRegionLandscapeChannels(legacyLandscape?.baseColor)
  });
  const normalizedBinding = (region as RegionDocument & {
    environmentBinding?: { defaultEnvironmentId?: string | null };
  }).environmentBinding;

  return {
    ...region,
    environmentBinding: {
      defaultEnvironmentId:
        normalizedBinding?.defaultEnvironmentId ?? defaultEnvironmentId(contentLibrary)
    },
    landscape: createDefaultRegionLandscapeState({
      ...defaultLandscape,
      ...(legacyLandscape ?? {}),
      channels:
        legacyLandscape?.channels && legacyLandscape.channels.length > 0
          ? legacyLandscape.channels
          : defaultLandscape.channels,
      paintPayload: legacyLandscape?.paintPayload ?? null
    })
  };
}

function createTransactionForCommand(
  command: SemanticCommand,
  affectedAggregateIds: string[]
) {
  return {
    transactionId: `tx-${createScopedId("authoring")}`,
    command,
    affectedAggregateIds,
    committedAt: new Date().toISOString() as TimestampIso
  };
}

function checkpointSession(session: AuthoringSession): SessionCheckpoint {
  return {
    contentLibrary: session.contentLibrary,
    regions: new Map(session.regions),
    activeRegionId: session.activeRegionId
  };
}

function restoreCheckpoint(
  session: AuthoringSession,
  checkpoint: SessionCheckpoint,
  nextUndoStack: SessionCheckpoint[],
  nextRedoStack: SessionCheckpoint[],
  nextHistory: AuthoringHistory
): AuthoringSession {
  return {
    ...session,
    contentLibrary: checkpoint.contentLibrary,
    regions: new Map(checkpoint.regions),
    activeRegionId: checkpoint.activeRegionId,
    undoStack: nextUndoStack,
    redoStack: nextRedoStack,
    history: nextHistory,
    isDirty: true
  };
}

export function getActiveRegion(session: AuthoringSession): RegionDocument | null {
  if (!session.activeRegionId) return null;
  return session.regions.get(session.activeRegionId) ?? null;
}

export function getAllRegions(session: AuthoringSession): RegionDocument[] {
  return Array.from(session.regions.values());
}

export function getAllAssetDefinitions(
  session: AuthoringSession
): AssetDefinition[] {
  return listAssetDefinitionsFromLibrary(session.contentLibrary);
}

export function getAllEnvironmentDefinitions(
  session: AuthoringSession
): EnvironmentDefinition[] {
  return listEnvironmentDefinitionsFromLibrary(session.contentLibrary);
}

export function createAuthoringSession(
  gameProject: GameProject,
  regions: RegionDocument[],
  contentLibrary: ContentLibrarySnapshot = createEmptyContentLibrarySnapshot(
    gameProject.identity.id
  )
): AuthoringSession {
  const normalizedContentLibrary = normalizeContentLibrarySnapshot(
    contentLibrary,
    gameProject.identity.id
  );
  const regionMap = new Map<string, RegionDocument>();
  for (const region of regions) {
    regionMap.set(
      region.identity.id,
      normalizeRegionDocument(region, normalizedContentLibrary)
    );
  }

  return {
    gameProject,
    contentLibrary: normalizedContentLibrary,
    regions: regionMap,
    activeRegionId: regions[0]?.identity.id ?? null,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: false
  };
}

export function switchActiveRegion(
  session: AuthoringSession,
  regionId: string
): AuthoringSession {
  if (!session.regions.has(regionId)) return session;
  if (session.activeRegionId === regionId) return session;

  return {
    ...session,
    activeRegionId: regionId,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory()
  };
}

function applyEnvironmentDefinitionCommand(
  session: AuthoringSession,
  command: UpdateEnvironmentDefinitionCommand
): AuthoringSession {
  const definitionIndex = session.contentLibrary.environmentDefinitions.findIndex(
    (definition) => definition.definitionId === command.payload.definitionId
  );
  if (definitionIndex < 0) {
    return session;
  }

  const nextDefinitions = [...session.contentLibrary.environmentDefinitions];
  nextDefinitions[definitionIndex] = command.payload.definition;
  const transaction = createTransactionForCommand(command, [command.payload.definitionId]);

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      environmentDefinitions: nextDefinitions
    },
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: pushTransaction(session.history, transaction),
    isDirty: true
  };
}

export function applyCommand(
  session: AuthoringSession,
  command: SemanticCommand
): AuthoringSession {
  if (command.kind === "UpdateEnvironmentDefinition") {
    return applyEnvironmentDefinitionCommand(session, command);
  }

  const activeRegion = getActiveRegion(session);
  if (!activeRegion) return session;

  const result = executeCommand(activeRegion, command);
  const newHistory = pushTransaction(session.history, result.transaction);

  const newRegions = new Map(session.regions);
  newRegions.set(result.region.identity.id, result.region);

  return {
    ...session,
    regions: newRegions,
    undoStack: [...session.undoStack, checkpointSession(session)],
    redoStack: [],
    history: newHistory,
    isDirty: true
  };
}

export function undoSession(
  session: AuthoringSession
): AuthoringSession {
  if (session.undoStack.length === 0) return session;

  const previous = session.undoStack[session.undoStack.length - 1];
  return restoreCheckpoint(
    session,
    previous,
    session.undoStack.slice(0, -1),
    [...session.redoStack, checkpointSession(session)],
    {
      undoStack: session.history.undoStack.slice(0, -1),
      redoStack: [
        ...session.history.redoStack,
        ...session.history.undoStack.slice(-1)
      ]
    }
  );
}

export function redoSession(
  session: AuthoringSession
): AuthoringSession {
  if (session.redoStack.length === 0) return session;

  const next = session.redoStack[session.redoStack.length - 1];
  return restoreCheckpoint(
    session,
    next,
    [...session.undoStack, checkpointSession(session)],
    session.redoStack.slice(0, -1),
    {
      undoStack: [
        ...session.history.undoStack,
        ...session.history.redoStack.slice(-1)
      ],
      redoStack: session.history.redoStack.slice(0, -1)
    }
  );
}

export function addRegionToSession(
  session: AuthoringSession,
  region: RegionDocument
): AuthoringSession {
  const normalizedRegion = normalizeRegionDocument(region, session.contentLibrary);
  const newRegions = new Map(session.regions);
  newRegions.set(normalizedRegion.identity.id, normalizedRegion);

  const newProject: GameProject = {
    ...session.gameProject,
    regionRegistry: [
      ...session.gameProject.regionRegistry,
      { regionId: normalizedRegion.identity.id }
    ]
  };

  return {
    ...session,
    gameProject: newProject,
    regions: newRegions,
    activeRegionId: normalizedRegion.identity.id,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: true
  };
}

export function addAssetDefinitionToSession(
  session: AuthoringSession,
  assetDefinition: AssetDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.assetDefinitions.findIndex(
    (definition) => definition.definitionId === assetDefinition.definitionId
  );

  const nextDefinitions = [...session.contentLibrary.assetDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = assetDefinition;
  } else {
    nextDefinitions.push(assetDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function addEnvironmentDefinitionToSession(
  session: AuthoringSession,
  environmentDefinition: EnvironmentDefinition
): AuthoringSession {
  const existingIndex = session.contentLibrary.environmentDefinitions.findIndex(
    (definition) => definition.definitionId === environmentDefinition.definitionId
  );

  const nextDefinitions = [...session.contentLibrary.environmentDefinitions];
  if (existingIndex >= 0) {
    nextDefinitions[existingIndex] = environmentDefinition;
  } else {
    nextDefinitions.push(environmentDefinition);
  }

  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      environmentDefinitions: nextDefinitions
    },
    isDirty: true
  };
}

export function updateAssetDefinitionInSession(
  session: AuthoringSession,
  definitionId: string,
  patch: Partial<Pick<AssetDefinition, "displayName">>
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: session.contentLibrary.assetDefinitions.map((definition) =>
        definition.definitionId === definitionId
          ? {
              ...definition,
              ...patch
            }
          : definition
      )
    },
    isDirty: true
  };
}

export function removeAssetDefinitionFromSession(
  session: AuthoringSession,
  definitionId: string
): AuthoringSession {
  return {
    ...session,
    contentLibrary: {
      ...session.contentLibrary,
      assetDefinitions: session.contentLibrary.assetDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      )
    },
    isDirty: true
  };
}

export function assetDefinitionHasSceneReferences(
  session: AuthoringSession,
  definitionId: string
): boolean {
  return getAllRegions(session).some((region) =>
    region.scene.placedAssets.some(
      (asset) => asset.assetDefinitionId === definitionId
    )
  );
}

export function environmentDefinitionHasRegionBindings(
  session: AuthoringSession,
  definitionId: string
): boolean {
  return getAllRegions(session).some(
    (region) => region.environmentBinding.defaultEnvironmentId === definitionId
  );
}

export function createAssetDefinitionId(fileNameStem: string): string {
  return createScopedId(`asset:${fileNameStem}`);
}

export function createPlacedAssetInstanceId(fileNameStem: string): string {
  return createScopedId(`placed-asset:${fileNameStem}`);
}

export function createSceneFolderId(): string {
  return createScopedId("scene-folder");
}

export function markSessionClean(
  session: AuthoringSession
): AuthoringSession {
  return { ...session, isDirty: false };
}
