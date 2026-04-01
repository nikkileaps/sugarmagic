/**
 * Authoring session: the canonical owner of in-memory authored documents.
 *
 * This is NOT a zustand store. It is a plain domain-owned container
 * for canonical authored truth, mutation history, and undo/redo.
 * Shell orchestration coordinates access to this session but does
 * not replace it as the source of truth.
 *
 * The session holds ALL loaded regions. The active region is the one
 * currently being edited. Switching region commits the current active
 * region back into the regions map before activating the new one.
 */

import type { GameProject } from "../game-project";
import type { RegionDocument } from "../region-authoring";
import type { AuthoringHistory } from "../history";
import type { SemanticCommand } from "../commands";
import { executeCommand, pushTransaction } from "../commands/executor";
import { createEmptyHistory } from "../commands/executor";

export interface AuthoringSession {
  gameProject: GameProject;
  /** All loaded regions, keyed by region ID */
  regions: Map<string, RegionDocument>;
  /** The region currently being edited */
  activeRegionId: string | null;
  undoStack: RegionDocument[];
  redoStack: RegionDocument[];
  history: AuthoringHistory;
  isDirty: boolean;
}

/** Convenience accessor — returns the active region document or null */
export function getActiveRegion(session: AuthoringSession): RegionDocument | null {
  if (!session.activeRegionId) return null;
  return session.regions.get(session.activeRegionId) ?? null;
}

/** Returns all regions as an array */
export function getAllRegions(session: AuthoringSession): RegionDocument[] {
  return Array.from(session.regions.values());
}

export function createAuthoringSession(
  gameProject: GameProject,
  regions: RegionDocument[]
): AuthoringSession {
  const regionMap = new Map<string, RegionDocument>();
  for (const region of regions) {
    regionMap.set(region.identity.id, region);
  }

  return {
    gameProject,
    regions: regionMap,
    activeRegionId: regions[0]?.identity.id ?? null,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: false
  };
}

/**
 * Switch the active region. Clears undo/redo since those are
 * scoped to the active region editing session.
 */
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

export function applyCommand(
  session: AuthoringSession,
  command: SemanticCommand
): AuthoringSession {
  const activeRegion = getActiveRegion(session);
  if (!activeRegion) return session;

  const result = executeCommand(activeRegion, command);
  const newHistory = pushTransaction(session.history, result.transaction);

  const newRegions = new Map(session.regions);
  newRegions.set(result.region.identity.id, result.region);

  return {
    ...session,
    regions: newRegions,
    undoStack: [...session.undoStack, activeRegion],
    redoStack: [],
    history: newHistory,
    isDirty: true
  };
}

export function undoSession(
  session: AuthoringSession
): AuthoringSession {
  const activeRegion = getActiveRegion(session);
  if (session.undoStack.length === 0 || !activeRegion) return session;

  const prev = session.undoStack[session.undoStack.length - 1];
  const newRegions = new Map(session.regions);
  newRegions.set(prev.identity.id, prev);

  return {
    ...session,
    regions: newRegions,
    undoStack: session.undoStack.slice(0, -1),
    redoStack: [...session.redoStack, activeRegion],
    history: {
      undoStack: session.history.undoStack.slice(0, -1),
      redoStack: [
        ...session.history.redoStack,
        ...session.history.undoStack.slice(-1)
      ]
    },
    isDirty: true
  };
}

export function redoSession(
  session: AuthoringSession
): AuthoringSession {
  const activeRegion = getActiveRegion(session);
  if (session.redoStack.length === 0 || !activeRegion) return session;

  const next = session.redoStack[session.redoStack.length - 1];
  const newRegions = new Map(session.regions);
  newRegions.set(next.identity.id, next);

  return {
    ...session,
    regions: newRegions,
    undoStack: [...session.undoStack, activeRegion],
    redoStack: session.redoStack.slice(0, -1),
    history: {
      undoStack: [
        ...session.history.undoStack,
        ...session.history.redoStack.slice(-1)
      ],
      redoStack: session.history.redoStack.slice(0, -1)
    },
    isDirty: true
  };
}

/**
 * Add a new region to the session and switch to it.
 * Also registers the region in the game project's regionRegistry.
 */
export function addRegionToSession(
  session: AuthoringSession,
  region: RegionDocument
): AuthoringSession {
  const newRegions = new Map(session.regions);
  newRegions.set(region.identity.id, region);

  const newProject: GameProject = {
    ...session.gameProject,
    regionRegistry: [
      ...session.gameProject.regionRegistry,
      { regionId: region.identity.id }
    ]
  };

  return {
    ...session,
    gameProject: newProject,
    regions: newRegions,
    activeRegionId: region.identity.id,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: true
  };
}

export function markSessionClean(
  session: AuthoringSession
): AuthoringSession {
  return { ...session, isDirty: false };
}
