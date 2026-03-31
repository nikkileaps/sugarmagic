import type { DocumentIdentity } from "../shared/identity";

export interface RegionPlacement {
  gridPosition: {
    x: number;
    y: number;
  };
  placementPolicy: "world-grid";
}

export interface PlacedAssetInstance {
  instanceId: string;
  assetDefinitionId: string;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}

export interface RegionEnvironmentState {
  skyProfileId: string | null;
  fogEnabled: boolean;
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
    placedAssets: PlacedAssetInstance[];
  };
  environment: RegionEnvironmentState;
  landscape: RegionLandscapeState;
  markers: RegionMarker[];
  gameplayPlacements: RegionGameplayPlacement[];
}
