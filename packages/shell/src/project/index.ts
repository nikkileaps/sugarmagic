/**
 * Project orchestration state.
 *
 * This is shell/session coordination state only. Canonical authored
 * documents live in the AuthoringSession (owned by packages/domain).
 * This store tracks project phase, IO handles, and holds a reference
 * to the current session — it does not own or replace canonical truth.
 */

import { createStore } from "zustand/vanilla";
import type { AuthoringSession } from "@sugarmagic/domain";
import type { GameRootDescriptor } from "@sugarmagic/io";

export type ProjectPhase = "no-project" | "loading" | "active" | "error";

export interface ProjectState {
  phase: ProjectPhase;
  handle: FileSystemDirectoryHandle | null;
  descriptor: GameRootDescriptor | null;
  session: AuthoringSession | null;
  error: string | null;
}

export interface ProjectActions {
  setActive: (
    handle: FileSystemDirectoryHandle,
    descriptor: GameRootDescriptor,
    session: AuthoringSession
  ) => void;
  updateSession: (session: AuthoringSession) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

export function createProjectStore() {
  return createStore<ProjectState & ProjectActions>()((set) => ({
    phase: "no-project",
    handle: null,
    descriptor: null,
    session: null,
    error: null,

    setActive: (handle, descriptor, session) =>
      set({
        phase: "active",
        handle,
        descriptor,
        session,
        error: null
      }),

    updateSession: (session) =>
      set({ session }),

    setError: (error) =>
      set({ phase: "error", error }),

    reset: () =>
      set({
        phase: "no-project",
        handle: null,
        descriptor: null,
        session: null,
        error: null
      })
  }));
}
