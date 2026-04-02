import type * as THREE from "three";
import type { RegionDocument } from "@sugarmagic/domain";

export interface WorkspaceViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  authoredRoot: THREE.Group;
  overlayRoot: THREE.Group;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromRegion: (region: RegionDocument) => void;
  previewTransform: (
    instanceId: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number]
  ) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
}
