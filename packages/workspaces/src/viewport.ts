import type * as THREE from "three";
import type { ContentLibrarySnapshot, RegionDocument } from "@sugarmagic/domain";

export interface ViewportAssetSources {
  [relativeAssetPath: string]: string;
}

export interface ViewportSceneState {
  region: RegionDocument;
  contentLibrary: ContentLibrarySnapshot;
  assetSources: ViewportAssetSources;
}

export interface WorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  authoredRoot: THREE.Group;
  overlayRoot: THREE.Group;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromRegion: (state: ViewportSceneState) => void;
  previewTransform: (
    instanceId: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number]
  ) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
}
