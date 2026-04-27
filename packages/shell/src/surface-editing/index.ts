/**
 * Surface-editing store.
 *
 * Owns the tiny shell-level UI state for the Surface Library workspace:
 * which SurfaceDefinition is currently being edited. This is editor-only state
 * and never commits into authored truth.
 */

import { createStore } from "zustand/vanilla";

export interface SurfaceEditingState {
  editedSurfaceDefinitionId: string | null;
  previewGeometryKind: "plane" | "cube" | "sphere";
}

export interface SurfaceEditingActions {
  setEditedSurfaceDefinitionId: (definitionId: string | null) => void;
  setPreviewGeometryKind: (kind: "plane" | "cube" | "sphere") => void;
}

export type SurfaceEditingStore = ReturnType<typeof createSurfaceEditingStore>;

export function createSurfaceEditingStore() {
  return createStore<SurfaceEditingState & SurfaceEditingActions>()((set, get) => ({
    editedSurfaceDefinitionId: null,
    previewGeometryKind: "plane",
    setEditedSurfaceDefinitionId(definitionId) {
      if (get().editedSurfaceDefinitionId === definitionId) {
        return;
      }
      set({ editedSurfaceDefinitionId: definitionId });
    },
    setPreviewGeometryKind(kind) {
      if (get().previewGeometryKind === kind) {
        return;
      }
      set({ previewGeometryKind: kind });
    }
  }));
}
