/**
 * Viewport overlay context.
 *
 * Internal scene-graph and state/action contract for editor overlays mounted
 * by the Studio viewport. Overlays are expected to observe shell/project
 * truth through `subscribeToProjection(...)`; imperative writes flow through
 * this narrow access seam instead of reaching into raw store bundles.
 */

import type * as THREE from "three";
import type {
  LandscapePaintStroke,
  TransformDraft,
  StoreBundleState
} from "@sugarmagic/shell";
import type {
  AuthoringSession,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RegionDocument,
  RegionLandscapeState
} from "@sugarmagic/domain";

declare const authoredRootBrand: unique symbol;
declare const overlayRootBrand: unique symbol;
declare const surfaceRootBrand: unique symbol;

export type AuthoredViewportRoot = THREE.Group & {
  readonly [authoredRootBrand]: "authored-root";
};

export type OverlayViewportRoot = THREE.Group & {
  readonly [overlayRootBrand]: "overlay-root";
};

export type SurfaceViewportRoot = THREE.Group & {
  readonly [surfaceRootBrand]: "surface-root";
};

export function asAuthoredViewportRoot(
  group: THREE.Group
): AuthoredViewportRoot {
  return group as AuthoredViewportRoot;
}

export function asOverlayViewportRoot(
  group: THREE.Group
): OverlayViewportRoot {
  return group as OverlayViewportRoot;
}

export function asSurfaceViewportRoot(
  group: THREE.Group
): SurfaceViewportRoot {
  return group as SurfaceViewportRoot;
}

export interface ViewportOverlayStateAccess {
  getSession(): AuthoringSession | null;
  getActiveRegion(): RegionDocument | null;
  updateSession(session: AuthoringSession): void;
  getSelectionIds(): string[];
  setSelection(entityIds: string[]): void;
  setTransformDraft(instanceId: string, transform: TransformDraft): void;
  getLandscapeDraft(): RegionLandscapeState | null;
  setLandscapeDraft(landscape: RegionLandscapeState | null): void;
  paintLandscape(
    canonicalLandscape: RegionLandscapeState,
    stroke: LandscapePaintStroke
  ): boolean;
  clearLandscapeDraft(): void;
  setActiveMaskPaintTarget(target: PaintedMaskTargetAddress | null): void;
  clearMaskPaintFillRequest(): void;
  /** Plan 068.8 -- force a shader re-apply (and with it the CPU
   *  scatter rebuild) for renderables matching the filter. Painted
   *  scatter masks need this after stroke/fill commits: appearance
   *  masks update through the live texture, but scatter instances
   *  are CPU-built and only change when application re-runs. */
  invalidateRenderableShaders(filter: {
    instanceId?: string;
    assetDefinitionId?: string;
  }): void;
  setCameraQuaternion(
    quaternion: [number, number, number, number]
  ): void;
}

export interface ViewportOverlayContext {
  overlayRoot: OverlayViewportRoot;
  authoredRoot: AuthoredViewportRoot;
  surfaceRoot: SurfaceViewportRoot;
  domElement: HTMLElement;
  stateAccess: ViewportOverlayStateAccess;
  getCamera(): THREE.Camera;
  setProjectionMode(mode: "perspective" | "orthographic-top"): void;
  readMaskTexture(maskTextureId: string): Promise<ImageData | null>;
  writeMaskTexture(maskTextureId: string, imageData: ImageData): Promise<void>;
  previewMaskTexture(maskTextureId: string, canvas: HTMLCanvasElement): void;
  /** Plan 068.9 -- mint a fresh blank painted-mask definition (creates
   *  the backing PNG + registers it in the session). The Surface Brush
   *  uses this to set up a slot's painted mask on first touch. */
  createMaskTextureDefinition(): Promise<MaskTextureDefinition | null>;
  subscribeToProjection<T>(
    selector: (state: StoreBundleState) => T,
    listener: (next: T) => void,
    opts?: { equalityFn?: (left: T, right: T) => boolean }
  ): () => void;
  subscribeFrame(listener: () => void): () => void;
}

export type ViewportOverlayFactory = (
  context: ViewportOverlayContext
) => () => void;
