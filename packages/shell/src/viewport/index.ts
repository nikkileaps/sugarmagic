/**
 * Viewport draft store.
 *
 * Owns transient authoring overlays for the build viewport: landscape drafts,
 * transform drafts, active tool/cursor state, brush settings, spatial-tool
 * selection, and camera-orientation UI hints. Canonical authored truth stays
 * in projectStore; this store exists only for uncommitted interactive state.
 *
 * Action contract: when nested viewport state changes semantically, actions
 * must publish fresh object/array references instead of mutating in place.
 * Projection subscribers compare nested values by reference, not deep value.
 */

import { createStore } from "zustand/vanilla";
import {
  LandscapeSplatmap,
  cloneSurfaceBinding,
  type RegionLandscapeState
} from "@sugarmagic/domain";

export type LandscapeBrushMode = "paint" | "erase";

export interface LandscapeBrushSettings {
  radius: number;
  strength: number;
  falloff: number;
  mode: LandscapeBrushMode;
}

export type TransformTool = "select" | "move" | "rotate" | "scale";

export interface LandscapeCursor {
  position: [number, number, number];
  visible: boolean;
}

export interface TransformDraft {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface LandscapePaintStroke {
  channelIndex: number;
  worldX: number;
  worldZ: number;
  radius: number;
  strength: number;
  falloff: number;
}

export interface ViewportState {
  landscapeDraft: RegionLandscapeState | null;
  transformDrafts: Record<string, TransformDraft>;
  activeToolCursor: LandscapeCursor | null;
  brushSettings: LandscapeBrushSettings | null;
  activeLandscapeChannelIndex: number;
  activeTransformTool: TransformTool;
  activeSpatialTool: "select" | "draw-rect";
  cameraQuaternion: [number, number, number, number];
}

export interface ViewportActions {
  setLandscapeDraft: (landscape: RegionLandscapeState | null) => void;
  clearLandscapeDraft: () => void;
  paintLandscape: (
    canonicalLandscape: RegionLandscapeState,
    stroke: LandscapePaintStroke
  ) => boolean;
  setTransformDraft: (instanceId: string, transform: TransformDraft) => void;
  clearTransformDraft: (instanceId: string) => void;
  clearTransformDrafts: () => void;
  setActiveToolCursor: (cursor: LandscapeCursor | null) => void;
  setBrushSettings: (settings: LandscapeBrushSettings | null) => void;
  setActiveLandscapeChannelIndex: (channelIndex: number) => void;
  setActiveTransformTool: (tool: TransformTool) => void;
  setActiveSpatialTool: (tool: "select" | "draw-rect") => void;
  setCameraQuaternion: (
    quaternion: [number, number, number, number]
  ) => void;
}

function cloneLandscape(landscape: RegionLandscapeState): RegionLandscapeState {
  return {
    ...landscape,
    surfaceSlots: landscape.surfaceSlots.map((slot) => ({
      ...slot,
      surface: cloneSurfaceBinding(slot.surface)
    })),
    paintPayload: landscape.paintPayload
      ? {
          ...landscape.paintPayload,
          layers: [...landscape.paintPayload.layers]
        }
      : null
  };
}

function paintLandscapeDraft(
  landscape: RegionLandscapeState,
  stroke: LandscapePaintStroke
): RegionLandscapeState {
  const nextLandscape = cloneLandscape(landscape);
  const splatmap = new LandscapeSplatmap(
    nextLandscape.paintPayload?.resolution ?? 256
  );
  splatmap.load(nextLandscape.paintPayload, nextLandscape.surfaceSlots.length);
  const size = Math.max(1, nextLandscape.size);
  const halfSize = size / 2;
  const centerU = (stroke.worldX + halfSize) / size;
  const centerV = (stroke.worldZ + halfSize) / size;
  splatmap.paint({
    channelIndex: stroke.channelIndex,
    centerU: Math.max(0, Math.min(1, centerU)),
    centerV: Math.max(0, Math.min(1, centerV)),
    radiusUV: stroke.radius / size,
    strength: stroke.strength,
    falloff: stroke.falloff
  });
  nextLandscape.paintPayload = splatmap.serialize();
  splatmap.dispose();
  return nextLandscape;
}

export type ViewportStore = ReturnType<typeof createViewportStore>;

export function createViewportStore() {
  return createStore<ViewportState & ViewportActions>()((set) => ({
    landscapeDraft: null,
    transformDrafts: {},
    activeToolCursor: null,
    brushSettings: {
      radius: 4,
      strength: 0.25,
      falloff: 0.7,
      mode: "paint"
    },
    activeLandscapeChannelIndex: 1,
    activeTransformTool: "move",
    activeSpatialTool: "select",
    cameraQuaternion: [0, 0, 0, 1],
    setLandscapeDraft(landscape) {
      set({ landscapeDraft: landscape });
    },
    clearLandscapeDraft() {
      set({ landscapeDraft: null });
    },
    paintLandscape(canonicalLandscape, stroke) {
      if (stroke.channelIndex < 1) {
        return false;
      }
      set((state) => ({
        landscapeDraft: paintLandscapeDraft(
          state.landscapeDraft ?? canonicalLandscape,
          stroke
        )
      }));
      return true;
    },
    setTransformDraft(instanceId, transform) {
      set((state) => ({
        transformDrafts: {
          ...state.transformDrafts,
          [instanceId]: transform
        }
      }));
    },
    clearTransformDraft(instanceId) {
      set((state) => {
        const nextDrafts = { ...state.transformDrafts };
        delete nextDrafts[instanceId];
        return { transformDrafts: nextDrafts };
      });
    },
    clearTransformDrafts() {
      set({ transformDrafts: {} });
    },
    setActiveToolCursor(cursor) {
      set({ activeToolCursor: cursor });
    },
    setBrushSettings(settings) {
      set({ brushSettings: settings });
    },
    setActiveLandscapeChannelIndex(channelIndex) {
      set({ activeLandscapeChannelIndex: channelIndex });
    },
    setActiveTransformTool(tool) {
      set({ activeTransformTool: tool });
    },
    setActiveSpatialTool(tool) {
      set({ activeSpatialTool: tool });
    },
    setCameraQuaternion(quaternion) {
      set({ cameraQuaternion: quaternion });
    }
  }));
}
