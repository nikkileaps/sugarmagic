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
