import type { DocumentIdentity } from "../shared/identity";
import { createScopedId } from "../shared/identity";

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

export type RegionLandscapeChannelMode = "color" | "material";

export interface RegionLandscapeChannelDefinition {
  channelId: string;
  displayName: string;
  mode: RegionLandscapeChannelMode;
  color: number;
  materialDefinitionId: string | null;
}

export interface RegionLandscapePaintPayload {
  version: 1;
  resolution: number;
  layers: string[];
}

export interface RegionLandscapeState {
  enabled: boolean;
  size: number;
  subdivisions: number;
  channels: RegionLandscapeChannelDefinition[];
  paintPayload: RegionLandscapePaintPayload | null;
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

export const DEFAULT_REGION_LANDSCAPE_SIZE = 100;
export const DEFAULT_REGION_LANDSCAPE_SUBDIVISIONS = 160;
export const DEFAULT_REGION_LANDSCAPE_RESOLUTION = 512;
export const DEFAULT_REGION_LANDSCAPE_BASE_COLOR = 0x7f8ea3;
export const DEFAULT_REGION_LANDSCAPE_GRASS_COLOR = 0x5c8a5a;

export const LANDSCAPE_BASE_CHANNEL_ID = "base";
export const LANDSCAPE_DEFAULT_CHANNEL_ID = "grass";
export const MAX_REGION_LANDSCAPE_CHANNELS = 8;

export function createLandscapeChannelId(): string {
  return createScopedId("landscape-channel");
}

export function createRegionLandscapeChannelDefinition(
  overrides: Partial<RegionLandscapeChannelDefinition> = {}
): RegionLandscapeChannelDefinition {
  return {
    channelId: overrides.channelId ?? createLandscapeChannelId(),
    displayName: overrides.displayName ?? "Channel",
    mode: overrides.mode ?? "color",
    color: overrides.color ?? DEFAULT_REGION_LANDSCAPE_GRASS_COLOR,
    materialDefinitionId:
      overrides.materialDefinitionId === undefined
        ? null
        : overrides.materialDefinitionId
  };
}

export function createDefaultRegionLandscapeChannels(
  baseColor = DEFAULT_REGION_LANDSCAPE_BASE_COLOR
): RegionLandscapeChannelDefinition[] {
  return [
    {
      channelId: LANDSCAPE_BASE_CHANNEL_ID,
      displayName: "Base",
      mode: "color",
      color: baseColor,
      materialDefinitionId: null
    },
    {
      channelId: LANDSCAPE_DEFAULT_CHANNEL_ID,
      displayName: "Grass",
      mode: "color",
      color: DEFAULT_REGION_LANDSCAPE_GRASS_COLOR,
      materialDefinitionId: null
    }
  ];
}

export function createDefaultRegionLandscapeState(
  overrides: Partial<RegionLandscapeState> = {}
): RegionLandscapeState {
  const channels =
    overrides.channels && overrides.channels.length > 0
      ? overrides.channels.slice(0, MAX_REGION_LANDSCAPE_CHANNELS)
      : createDefaultRegionLandscapeChannels();

  return {
    enabled: true,
    size: DEFAULT_REGION_LANDSCAPE_SIZE,
    subdivisions: DEFAULT_REGION_LANDSCAPE_SUBDIVISIONS,
    ...overrides,
    channels,
    paintPayload: overrides.paintPayload ?? null
  };
}
