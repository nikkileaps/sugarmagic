import type { DocumentIdentity } from "../shared/identity";

export interface RegionPlacement {
  gridPosition: {
    x: number;
    y: number;
  };
  placementPolicy: "world-grid";
}

export interface RegionSceneFolder {
  folderId: string;
  displayName: string;
  parentFolderId: string | null;
}

export interface PlacedAssetInstance {
  instanceId: string;
  assetDefinitionId: string;
  displayName: string;
  parentFolderId: string | null;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}

export interface RegionEnvironmentBinding {
  defaultEnvironmentId: string | null;
}

export interface RegionLandscapeState {
  enabled: boolean;
  channelIds: string[];
}

export interface RegionMarker {
  markerId: string;
  kind: string;
  position: [number, number, number];
}

export interface RegionGameplayPlacement {
  placementId: string;
  placementKind: "npc" | "trigger" | "pickup" | "inspectable" | "vfx-spawn";
  definitionId: string;
}

export interface RegionDocument {
  identity: DocumentIdentity;
  displayName: string;
  placement: RegionPlacement;
  scene: {
    folders: RegionSceneFolder[];
    placedAssets: PlacedAssetInstance[];
  };
  environmentBinding: RegionEnvironmentBinding;
  landscape: RegionLandscapeState;
  markers: RegionMarker[];
  gameplayPlacements: RegionGameplayPlacement[];
}
