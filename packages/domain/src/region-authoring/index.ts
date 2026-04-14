import type { DocumentIdentity } from "../shared/identity";
import { createScopedId, createUuid } from "../shared/identity";
import type {
  ShaderBindingOverride,
  ShaderParameterOverride
} from "../shader-graph";

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
  shaderOverride: ShaderBindingOverride | null;
  shaderParameterOverrides: ShaderParameterOverride[];
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
  shaderOverride: ShaderBindingOverride | null;
  shaderParameterOverrides: ShaderParameterOverride[];
  transform: RegionSceneTransform;
}

export interface RegionItemPresence {
  presenceId: string;
  itemDefinitionId: string;
  quantity: number;
  shaderOverride: ShaderBindingOverride | null;
  shaderParameterOverrides: ShaderParameterOverride[];
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

export interface RegionBehaviorQuestBinding {
  questDefinitionId: string | null;
  questStageId: string | null;
  worldFlagEquals: RegionBehaviorWorldFlagCondition | null;
}

export interface RegionBehaviorWorldFlagCondition {
  key: string | null;
  valueType: "boolean" | "number" | "string";
  value: string | null;
}

export interface RegionNPCBehaviorTask {
  taskId: string;
  displayName: string;
  description: string | null;
  targetAreaId: string | null;
  currentActivity: string;
  currentGoal: string;
  activation: RegionBehaviorQuestBinding;
}

export const REGION_NPC_BEHAVIOR_ACTIVITY_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "waiting", label: "Waiting" },
  { value: "walking", label: "Walking" },
  { value: "collecting_delivery", label: "Collecting Delivery" },
  { value: "unpacking_inventory", label: "Unpacking Inventory" },
  { value: "running_shop", label: "Running Shop" },
  { value: "serving_customers", label: "Serving Customers" },
  { value: "helping_player", label: "Helping Player" },
  { value: "searching", label: "Searching" },
  { value: "observing", label: "Observing" }
] as const;

export const REGION_NPC_BEHAVIOR_GOAL_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "wait_for_delivery", label: "Wait for Delivery" },
  { value: "collect_delivery", label: "Collect Delivery" },
  { value: "stock_shop", label: "Stock Shop" },
  { value: "serve_customers", label: "Serve Customers" },
  { value: "help_player", label: "Help Player" },
  { value: "search_area", label: "Search Area" },
  { value: "return_to_shop", label: "Return to Shop" },
  { value: "observe_situation", label: "Observe Situation" }
] as const;

export interface RegionNPCBehaviorDefinition {
  behaviorId: string;
  npcDefinitionId: string;
  displayName: string;
  tasks: RegionNPCBehaviorTask[];
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
  behaviors: RegionNPCBehaviorDefinition[];
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

export function createRegionNPCBehaviorId(): string {
  return createScopedId("region-behavior");
}

function createPlacedAssetInstanceIdValue(): string {
  return createScopedId("placed-asset");
}

function createSceneFolderIdValue(): string {
  return createScopedId("scene-folder");
}

export function createRegionNPCBehaviorTaskId(): string {
  return createScopedId("region-behavior-task");
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

export function createRegionBehaviorQuestBinding(
  overrides: Partial<RegionBehaviorQuestBinding> = {}
): RegionBehaviorQuestBinding {
  return {
    questDefinitionId:
      typeof overrides.questDefinitionId === "string" &&
      overrides.questDefinitionId.trim().length > 0
        ? overrides.questDefinitionId.trim()
        : null,
    questStageId:
      typeof overrides.questStageId === "string" &&
      overrides.questStageId.trim().length > 0
        ? overrides.questStageId.trim()
        : null,
    worldFlagEquals:
      typeof overrides.worldFlagEquals?.key === "string" &&
      overrides.worldFlagEquals.key.trim().length > 0
        ? {
            key: overrides.worldFlagEquals.key.trim(),
            valueType: overrides.worldFlagEquals.valueType ?? "boolean",
            value:
              typeof overrides.worldFlagEquals.value === "string" &&
              overrides.worldFlagEquals.value.trim().length > 0
                ? overrides.worldFlagEquals.value.trim()
                : null
          }
        : null
  };
}

export function createRegionNPCBehaviorTask(
  overrides: Partial<RegionNPCBehaviorTask> = {}
): RegionNPCBehaviorTask {
  return {
    taskId: overrides.taskId ?? createRegionNPCBehaviorTaskId(),
    displayName: overrides.displayName ?? "Behavior Task",
    description:
      typeof overrides.description === "string" && overrides.description.trim().length > 0
        ? overrides.description
        : null,
    targetAreaId:
      typeof overrides.targetAreaId === "string" && overrides.targetAreaId.trim().length > 0
        ? overrides.targetAreaId.trim()
        : null,
    currentActivity:
      typeof overrides.currentActivity === "string" && overrides.currentActivity.trim().length > 0
        ? overrides.currentActivity.trim()
        : "idle",
    currentGoal:
      typeof overrides.currentGoal === "string" && overrides.currentGoal.trim().length > 0
        ? overrides.currentGoal.trim()
        : "idle",
    activation: createRegionBehaviorQuestBinding(overrides.activation)
  };
}

export function createRegionNPCBehaviorDefinition(
  overrides: Partial<RegionNPCBehaviorDefinition> &
    Pick<RegionNPCBehaviorDefinition, "npcDefinitionId">,
): RegionNPCBehaviorDefinition {
  return {
    behaviorId: overrides.behaviorId ?? createRegionNPCBehaviorId(),
    npcDefinitionId: overrides.npcDefinitionId,
    displayName: overrides.displayName ?? "NPC Behavior",
    tasks: (overrides.tasks ?? []).map((task) =>
      createRegionNPCBehaviorTask(task)
    )
  };
}

export function createLandscapeChannelId(): string {
  return createScopedId("landscape-channel");
}

export function createPlacedAssetInstance(
  overrides: Partial<PlacedAssetInstance> &
    Pick<PlacedAssetInstance, "assetDefinitionId">,
): PlacedAssetInstance {
  return {
    instanceId: overrides.instanceId ?? createPlacedAssetInstanceIdValue(),
    assetDefinitionId: overrides.assetDefinitionId,
    displayName: overrides.displayName ?? "Placed Asset",
    parentFolderId: overrides.parentFolderId ?? null,
    inspectable: overrides.inspectable ?? null,
    shaderOverride: overrides.shaderOverride ?? null,
    shaderParameterOverrides: [...(overrides.shaderParameterOverrides ?? [])],
    transform: {
      position: overrides.transform?.position ?? [0, 0, 0],
      rotation: overrides.transform?.rotation ?? [0, 0, 0],
      scale: overrides.transform?.scale ?? [1, 1, 1]
    }
  };
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
    shaderOverride: overrides.shaderOverride ?? null,
    shaderParameterOverrides: [...(overrides.shaderParameterOverrides ?? [])],
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
    shaderOverride: overrides.shaderOverride ?? null,
    shaderParameterOverrides: [...(overrides.shaderParameterOverrides ?? [])],
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
