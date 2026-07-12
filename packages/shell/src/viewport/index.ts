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
  type PaintedMaskTargetAddress,
  type RegionLandscapeState
} from "@sugarmagic/domain";

export type LandscapeBrushMode = "paint" | "erase" | "sketch";

export interface LandscapeBrushSettings {
  radius: number;
  strength: number;
  falloff: number;
  mode: LandscapeBrushMode;
}

/**
 * Plan 065 §065.1 — Layout Sketch pencil settings. Transient UI
 * state (tool feel + visibility); the ink itself is canonical on
 * `RegionDocument.layoutSketch`.
 */
export interface LandscapeSketchSettings {
  /** Ink color as a css hex string. */
  color: string;
  /** Stroke width in world meters. */
  size: number;
  /** Ink alpha, 0..1. */
  opacity: number;
  /** Pencil erases ink instead of drawing. */
  erase: boolean;
  /** Show/hide the whole sketch overlay (ink + reference). */
  visible: boolean;
}

export const DEFAULT_SKETCH_SETTINGS: LandscapeSketchSettings = {
  color: "#1e1e2e",
  size: 0.6,
  opacity: 0.9,
  erase: false,
  visible: true
};

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

/**
 * Plan 065 SS065.2 -- scatter/prop brush settings. Transient UI
 * state (tool feel + palette); the landed instances are canonical
 * PlacedAssetInstances committed through BrushPlaceAssets /
 * BrushEraseAssets commands.
 */
export interface ScatterBrushSettings {
  /** Brush radius in world meters. */
  radius: number;
  /** Target instances per square meter within the ring, per stamp. */
  density: number;
  /** Asset definitions the brush picks from at random. */
  paletteAssetDefinitionIds: string[];
  /** Uniform scale range applied per instance. */
  scaleJitter: [number, number];
  /** 0..1 fraction of a full turn of random yaw per instance. */
  rotationJitter: number;
  mode: "paint" | "erase";
}

export interface ViewportState {
  landscapeDraft: RegionLandscapeState | null;
  transformDrafts: Record<string, TransformDraft>;
  activeToolCursor: LandscapeCursor | null;
  brushSettings: LandscapeBrushSettings | null;
  activeMaskPaintTarget: PaintedMaskTargetAddress | null;
  activeLandscapeChannelIndex: number;
  activeTransformTool: TransformTool;
  activeSpatialTool: "select" | "draw-rect";
  cameraQuaternion: [number, number, number, number];
  sketchSettings: LandscapeSketchSettings;
  /** Non-null while the Layout scatter brush tool is active. */
  scatterBrushSettings: ScatterBrushSettings | null;
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
  setActiveMaskPaintTarget: (target: PaintedMaskTargetAddress | null) => void;
  setActiveLandscapeChannelIndex: (channelIndex: number) => void;
  setActiveTransformTool: (tool: TransformTool) => void;
  setActiveSpatialTool: (tool: "select" | "draw-rect") => void;
  setCameraQuaternion: (
    quaternion: [number, number, number, number]
  ) => void;
  setSketchSettings: (settings: LandscapeSketchSettings) => void;
  setScatterBrushSettings: (settings: ScatterBrushSettings | null) => void;
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
    activeMaskPaintTarget: null,
    activeLandscapeChannelIndex: 1,
    activeTransformTool: "move",
    activeSpatialTool: "select",
    cameraQuaternion: [0, 0, 0, 1],
    sketchSettings: DEFAULT_SKETCH_SETTINGS,
    scatterBrushSettings: null,
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
    setActiveMaskPaintTarget(target) {
      set({ activeMaskPaintTarget: target });
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
    },
    setScatterBrushSettings(settings) {
      set({ scatterBrushSettings: settings });
    },
    setSketchSettings(settings) {
      set({ sketchSettings: settings });
    }
  }));
}
