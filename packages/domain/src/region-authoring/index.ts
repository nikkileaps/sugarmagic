import type { DocumentIdentity } from "../shared/identity";
import { createScopedId, createUuid } from "../shared/identity";

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
  inspectable: RegionInspectableBehavior | null;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}

export interface RegionSceneTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface RegionPlayerPresence {
  presenceId: string;
  transform: RegionSceneTransform;
}

export interface RegionNPCPresence {
  presenceId: string;
  npcDefinitionId: string;
  transform: RegionSceneTransform;
}

export interface RegionItemPresence {
  presenceId: string;
  itemDefinitionId: string;
  quantity: number;
  transform: RegionSceneTransform;
}

export interface RegionInspectableBehavior {
  behaviorId: string;
  documentDefinitionId: string;
  promptText?: string;
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

export type RegionAreaKind =
  | "zone"
  | "interior"
  | "exterior"
  | "room"
  | "stall"
  | "platform"
  | "shop";

export interface RegionAreaBounds {
  kind: "box";
  center: [number, number, number];
  size: [number, number, number];
}

export interface RegionAreaDefinition {
  areaId: string;
  displayName: string;
  lorePageId: string | null;
  parentAreaId: string | null;
  kind: RegionAreaKind;
  bounds: RegionAreaBounds;
}

export interface RegionDocument {
  identity: DocumentIdentity;
  displayName: string;
  lorePageId?: string | null;
  placement: RegionPlacement;
  scene: {
    folders: RegionSceneFolder[];
    placedAssets: PlacedAssetInstance[];
    playerPresence: RegionPlayerPresence | null;
    npcPresences: RegionNPCPresence[];
    itemPresences: RegionItemPresence[];
  };
  environmentBinding: RegionEnvironmentBinding;
  areas: RegionAreaDefinition[];
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
export const DEFAULT_REGION_AREA_HEIGHT = 12;

export function createRegionAreaId(): string {
  return createScopedId("region-area");
}

export function createRegionAreaBounds(
  overrides: Partial<RegionAreaBounds> = {}
): RegionAreaBounds {
  return {
    kind: "box",
    center: overrides.center ?? [0, DEFAULT_REGION_AREA_HEIGHT / 2, 0],
    size: overrides.size ?? [4, DEFAULT_REGION_AREA_HEIGHT, 4]
  };
}

export function createRegionAreaDefinition(
  overrides: Partial<RegionAreaDefinition> = {}
): RegionAreaDefinition {
  return {
    areaId: overrides.areaId ?? createRegionAreaId(),
    displayName: overrides.displayName ?? "Area",
    lorePageId:
      overrides.lorePageId === undefined ? null : overrides.lorePageId,
    parentAreaId:
      overrides.parentAreaId === undefined ? null : overrides.parentAreaId,
    kind: overrides.kind ?? "zone",
    bounds: createRegionAreaBounds(overrides.bounds)
  };
}

export function createLandscapeChannelId(): string {
  return createScopedId("landscape-channel");
}

export function createRegionSceneTransform(
  overrides: Partial<RegionSceneTransform> = {}
): RegionSceneTransform {
  return {
    position: overrides.position ?? [0, 0, 0],
    rotation: overrides.rotation ?? [0, 0, 0],
    scale: overrides.scale ?? [1, 1, 1]
  };
}

export function createPlayerPresenceId(): string {
  return createUuid();
}

export function createNPCPresenceId(): string {
  return createUuid();
}

export function createItemPresenceId(): string {
  return createUuid();
}

export function createInspectableBehaviorId(): string {
  return createUuid();
}

export function createRegionPlayerPresence(
  overrides: Partial<RegionPlayerPresence> = {}
): RegionPlayerPresence {
  return {
    presenceId: overrides.presenceId ?? createPlayerPresenceId(),
    transform: createRegionSceneTransform(overrides.transform)
  };
}

export function createRegionNPCPresence(
  overrides: Partial<RegionNPCPresence> & Pick<RegionNPCPresence, "npcDefinitionId">
): RegionNPCPresence {
  return {
    presenceId: overrides.presenceId ?? createNPCPresenceId(),
    npcDefinitionId: overrides.npcDefinitionId,
    transform: createRegionSceneTransform(overrides.transform)
  };
}

export function createRegionItemPresence(
  overrides: Partial<RegionItemPresence> &
    Pick<RegionItemPresence, "itemDefinitionId">
): RegionItemPresence {
  return {
    presenceId: overrides.presenceId ?? createItemPresenceId(),
    itemDefinitionId: overrides.itemDefinitionId,
    quantity: Math.max(1, Math.floor(overrides.quantity ?? 1)),
    transform: createRegionSceneTransform(overrides.transform)
  };
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
