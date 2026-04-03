import type * as THREE from "three";
import type {
  ContentLibrarySnapshot,
  RegionDocument,
  RegionLandscapePaintPayload,
  RegionLandscapeState
} from "@sugarmagic/domain";

export interface ViewportAssetSources {
  [relativeAssetPath: string]: string;
}

export interface ViewportSceneState {
  region: RegionDocument;
  contentLibrary: ContentLibrarySnapshot;
  assetSources: ViewportAssetSources;
  environmentOverrideId?: string | null;
}

export interface WorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  authoredRoot: THREE.Group;
  overlayRoot: THREE.Group;
  surfaceRoot: THREE.Group;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromRegion: (state: ViewportSceneState) => void;
  previewLandscape: (landscape: RegionLandscapeState) => void;
  paintLandscapeAt: (options: {
    channelIndex: number;
    worldX: number;
    worldZ: number;
    radius: number;
    strength: number;
    falloff: number;
  }) => boolean;
  renderLandscapeMask: (
    channelIndex: number,
    canvas: HTMLCanvasElement
  ) => void;
  serializeLandscapePaintPayload: () => RegionLandscapePaintPayload | null;
  previewTransform: (
    instanceId: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number]
  ) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  subscribeFrame: (listener: () => void) => () => void;
}
