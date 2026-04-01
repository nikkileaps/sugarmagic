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
import type { AuthoringHistory } from "../history";
import type { SemanticCommand } from "../commands";
import { executeCommand, pushTransaction } from "../commands/executor";
import { createEmptyHistory } from "../commands/executor";

export interface AuthoringSession {
  gameProject: GameProject;
  activeRegion: RegionDocument | null;
  undoStack: RegionDocument[];
  redoStack: RegionDocument[];
  history: AuthoringHistory;
  isDirty: boolean;
}

export function createAuthoringSession(
  gameProject: GameProject,
  regions: RegionDocument[]
): AuthoringSession {
  return {
    gameProject,
    activeRegion: regions[0] ?? null,
    undoStack: [],
    redoStack: [],
    history: createEmptyHistory(),
    isDirty: false
  };
}

export function applyCommand(
  session: AuthoringSession,
  command: SemanticCommand
): AuthoringSession {
  if (!session.activeRegion) return session;

  const result = executeCommand(session.activeRegion, command);
  const newHistory = pushTransaction(session.history, result.transaction);

  return {
    ...session,
    activeRegion: result.region,
    undoStack: [...session.undoStack, session.activeRegion],
    redoStack: [],
    history: newHistory,
    isDirty: true
  };
}

export function undoSession(
  session: AuthoringSession
): AuthoringSession {
  if (session.undoStack.length === 0 || !session.activeRegion) return session;

  const prev = session.undoStack[session.undoStack.length - 1];
  return {
    ...session,
    activeRegion: prev,
    undoStack: session.undoStack.slice(0, -1),
    redoStack: [...session.redoStack, session.activeRegion],
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
  if (session.redoStack.length === 0 || !session.activeRegion) return session;

  const next = session.redoStack[session.redoStack.length - 1];
  return {
    ...session,
    activeRegion: next,
    undoStack: [...session.undoStack, session.activeRegion],
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

export function markSessionClean(
  session: AuthoringSession
): AuthoringSession {
  return { ...session, isDirty: false };
}
