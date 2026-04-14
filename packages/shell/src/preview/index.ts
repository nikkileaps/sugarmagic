/**
 * Preview state: shell coordination for preview lifecycle.
 *
 * Preview is a global shell action, not a ProductMode.
 * This module tracks whether preview is running and holds
 * the authoring context snapshot for restoration on stop.
 *
 * Runtime session truth lives in the preview window, not here.
 */

import { createStore } from "zustand/vanilla";
import type { ProductModeId } from "@sugarmagic/productmodes";
import type {
  BuildWorkspaceKind,
  DesignWorkspaceKind,
  RenderWorkspaceKind
} from "../index";

export interface AuthoringContextSnapshot {
  activeProductMode: ProductModeId;
  activeBuildWorkspaceKind: BuildWorkspaceKind;
  activeDesignWorkspaceKind: DesignWorkspaceKind;
  activeRenderWorkspaceKind: RenderWorkspaceKind;
  activeRegionId: string | null;
  activeEnvironmentId: string | null;
  activeWorkspaceId: string | null;
  selectedEntityIds: string[];
}

export interface PreviewState {
  isPreviewRunning: boolean;
  previewWindow: Window | null;
  authoringSnapshot: AuthoringContextSnapshot | null;
}

export interface PreviewActions {
  startPreview: (
    snapshot: AuthoringContextSnapshot,
    previewWindow: Window
  ) => void;
  stopPreview: () => AuthoringContextSnapshot | null;
}

export type PreviewStore = ReturnType<typeof createPreviewStore>;

export function createPreviewStore() {
  return createStore<PreviewState & PreviewActions>()((set, get) => ({
    isPreviewRunning: false,
    previewWindow: null,
    authoringSnapshot: null,

    startPreview: (snapshot, previewWindow) =>
      set({
        isPreviewRunning: true,
        previewWindow,
        authoringSnapshot: snapshot
      }),

    stopPreview: () => {
      const snapshot = get().authoringSnapshot;
      const win = get().previewWindow;
      if (win && !win.closed) {
        win.close();
      }
      set({
        isPreviewRunning: false,
        previewWindow: null,
        authoringSnapshot: null
      });
      return snapshot;
    }
  }));
}
