/**
 * Design-preview store.
 *
 * Owns preview-only UI state for the Player / NPC / Item workspaces. These
 * values never commit into authored truth; they exist so both React chrome and
 * the preview viewport can observe one canonical preview configuration.
 */

import { createStore } from "zustand/vanilla";

export interface DesignPreviewCameraFraming {
  quaternion: [number, number, number, number];
  orbitDistance: number;
  target: [number, number, number];
}

export interface DesignPreviewState {
  activeDefinitionId: string | null;
  activeAnimationSlot: string | null;
  isAnimationPlaying: boolean;
  cameraFraming: DesignPreviewCameraFraming | null;
}

export interface DesignPreviewActions {
  beginPreview: (definitionId: string) => void;
  endPreview: () => void;
  setAnimationSlot: (slot: string | null) => void;
  setAnimationPlaying: (playing: boolean) => void;
  setCameraFraming: (framing: DesignPreviewCameraFraming | null) => void;
}

export type DesignPreviewStore = ReturnType<typeof createDesignPreviewStore>;

function cameraFramingEquals(
  previous: DesignPreviewCameraFraming | null,
  next: DesignPreviewCameraFraming | null
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next) {
    return false;
  }
  return (
    previous.orbitDistance === next.orbitDistance &&
    previous.quaternion[0] === next.quaternion[0] &&
    previous.quaternion[1] === next.quaternion[1] &&
    previous.quaternion[2] === next.quaternion[2] &&
    previous.quaternion[3] === next.quaternion[3] &&
    previous.target[0] === next.target[0] &&
    previous.target[1] === next.target[1] &&
    previous.target[2] === next.target[2]
  );
}

export function createDesignPreviewStore() {
  return createStore<DesignPreviewState & DesignPreviewActions>()((set, get) => ({
    activeDefinitionId: null,
    activeAnimationSlot: null,
    isAnimationPlaying: true,
    cameraFraming: null,
    beginPreview(definitionId) {
      if (get().activeDefinitionId === definitionId) {
        return;
      }
      set({
        activeDefinitionId: definitionId,
        activeAnimationSlot: null,
        isAnimationPlaying: true,
        cameraFraming: null
      });
    },
    endPreview() {
      set({
        activeDefinitionId: null,
        activeAnimationSlot: null,
        isAnimationPlaying: true,
        cameraFraming: null
      });
    },
    setAnimationSlot(slot) {
      set({ activeAnimationSlot: slot });
    },
    setAnimationPlaying(playing) {
      set({ isAnimationPlaying: playing });
    },
    setCameraFraming(framing) {
      if (cameraFramingEquals(get().cameraFraming, framing)) {
        return;
      }
      set({ cameraFraming: framing });
    }
  }));
}
