import type * as THREE from "three";
import type {
  ContentLibrarySnapshot,
  ItemDefinition,
  NPCDefinition,
  NPCAnimationSlot,
  PlayerAnimationSlot,
  PlayerDefinition,
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
  playerDefinition: PlayerDefinition;
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  assetSources: ViewportAssetSources;
  environmentOverrideId?: string | null;
}

export interface PlayerViewportState {
  playerDefinition: PlayerDefinition;
  contentLibrary: ContentLibrarySnapshot;
  assetSources: ViewportAssetSources;
  activeAnimationSlot: PlayerAnimationSlot | null;
  isAnimationPlaying: boolean;
}

export interface NPCViewportState {
  npcDefinition: NPCDefinition;
  contentLibrary: ContentLibrarySnapshot;
  assetSources: ViewportAssetSources;
  activeAnimationSlot: NPCAnimationSlot | null;
  isAnimationPlaying: boolean;
}

export interface ItemViewportState {
  itemDefinition: ItemDefinition;
  contentLibrary: ContentLibrarySnapshot;
  assetSources: ViewportAssetSources;
}

export interface WorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.Camera;
  authoredRoot: THREE.Group;
  overlayRoot: THREE.Group;
  surfaceRoot: THREE.Group;
  setProjectionMode: (mode: "perspective" | "orthographic-top") => void;
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

export interface PlayerWorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromPlayer: (state: PlayerViewportState) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  subscribeFrame: (listener: () => void) => () => void;
}

export interface NPCWorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromNPC: (state: NPCViewportState) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  subscribeFrame: (listener: () => void) => () => void;
}

export interface ItemWorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromItem: (state: ItemViewportState) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  subscribeFrame: (listener: () => void) => () => void;
}
