import type { DocumentDefinition } from "../document-definition";
import type {
  RegionNPCBehaviorDefinition,
  RegionLandscapePaintPayload
} from "../region-authoring";
import type { EnvironmentDefinition } from "../content-library";
import type {
  PostProcessShaderBinding,
  ShaderGraphDocument,
  ShaderNodeInstance,
  ShaderEdge,
  ShaderParameter,
  ShaderParameterOverride,
  ShaderSlotKind
} from "../shader-graph";
import type { DialogueDefinition } from "../dialogue-definition";
import type { ItemDefinition } from "../item-definition";
import type { NPCDefinition } from "../npc-definition";
import type { PlayerDefinition } from "../player-definition";
import type { QuestDefinition } from "../quest-definition";
import type { PluginConfigurationRecord } from "../plugins";
import type { SpellDefinition } from "../spell-definition";
import type { DeploymentSettings } from "../deployment";
import type { DocumentId, SubjectReference } from "../shared/identity";
import type { LandscapeSurfaceSlot, Surface } from "../surface";

export type AuthoringAggregateKind =
  | "game-project"
  | "region-document"
  | "content-definition"
  | "plugin-config";

export interface AuthoringAggregateRef {
  aggregateKind: AuthoringAggregateKind;
  aggregateId: DocumentId;
}

export interface SemanticCommandBase<TKind extends string, TPayload> {
  kind: TKind;
  target: AuthoringAggregateRef;
  subject: SubjectReference;
  payload: TPayload;
}

export type MovePlacedAssetCommand = SemanticCommandBase<
  "MovePlacedAsset",
  {
    instanceId: string;
    position: [number, number, number];
  }
>;

export type PlaceAssetInstanceCommand = SemanticCommandBase<
  "PlaceAssetInstance",
  {
    instanceId: string;
    assetDefinitionId: string;
    displayName: string;
    parentFolderId: string | null;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type DuplicatePlacedAssetCommand = SemanticCommandBase<
  "DuplicatePlacedAsset",
  {
    sourceInstanceId: string;
    duplicatedInstanceId: string;
    positionOffset: [number, number, number];
  }
>;

export type RemovePlacedAssetCommand = SemanticCommandBase<
  "RemovePlacedAsset",
  {
    instanceId: string;
  }
>;

export type MovePlacedAssetToFolderCommand = SemanticCommandBase<
  "MovePlacedAssetToFolder",
  {
    instanceId: string;
    parentFolderId: string | null;
  }
>;

export type CreateSceneFolderCommand = SemanticCommandBase<
  "CreateSceneFolder",
  {
    folderId: string;
    displayName: string;
    parentFolderId: string | null;
  }
>;

export type RenameSceneFolderCommand = SemanticCommandBase<
  "RenameSceneFolder",
  {
    folderId: string;
    displayName: string;
  }
>;

export type DeleteSceneFolderCommand = SemanticCommandBase<
  "DeleteSceneFolder",
  {
    folderId: string;
  }
>;

export type UpdateRegionMetadataCommand = SemanticCommandBase<
  "UpdateRegionMetadata",
  {
    displayName?: string;
    lorePageId?: string | null;
  }
>;

export type CreateRegionAreaCommand = SemanticCommandBase<
  "CreateRegionArea",
  {
    areaId: string;
    displayName: string;
    lorePageId: string | null;
    parentAreaId: string | null;
    kind: import("../region-authoring").RegionAreaKind;
    bounds: import("../region-authoring").RegionAreaBounds;
  }
>;

export type UpdateRegionAreaCommand = SemanticCommandBase<
  "UpdateRegionArea",
  {
    areaId: string;
    displayName?: string;
    lorePageId?: string | null;
    parentAreaId?: string | null;
    kind?: import("../region-authoring").RegionAreaKind;
    bounds?: import("../region-authoring").RegionAreaBounds;
  }
>;

export type DeleteRegionAreaCommand = SemanticCommandBase<
  "DeleteRegionArea",
  {
    areaId: string;
  }
>;

export type CreateRegionNPCBehaviorCommand = SemanticCommandBase<
  "CreateRegionNPCBehavior",
  {
    behavior: RegionNPCBehaviorDefinition;
  }
>;

export type UpdateRegionNPCBehaviorCommand = SemanticCommandBase<
  "UpdateRegionNPCBehavior",
  {
    behavior: RegionNPCBehaviorDefinition;
  }
>;

export type DeleteRegionNPCBehaviorCommand = SemanticCommandBase<
  "DeleteRegionNPCBehavior",
  {
    behaviorId: string;
  }
>;

export type CreateLandscapeChannelCommand = SemanticCommandBase<
  "CreateLandscapeChannel",
  {
    channel: LandscapeSurfaceSlot;
  }
>;

export type UpdateLandscapeChannelCommand = SemanticCommandBase<
  "UpdateLandscapeChannel",
  {
    channelId: string;
    displayName?: string;
    slotName?: string;
    surface?: Surface | null;
    tilingScale?: [number, number] | null;
  }
>;

export type PaintLandscapeCommand = SemanticCommandBase<
  "PaintLandscape",
  {
    paintPayload: RegionLandscapePaintPayload | null;
    affectedBounds: [number, number, number, number];
  }
>;

export type ConfigureLandscapeCommand = SemanticCommandBase<
  "ConfigureLandscape",
  {
    enabled?: boolean;
    size?: number;
    subdivisions?: number;
  }
>;

export type UpdateEnvironmentDefinitionCommand = SemanticCommandBase<
  "UpdateEnvironmentDefinition",
  {
    definitionId: string;
    definition: EnvironmentDefinition;
  }
>;

export type CreateShaderGraphCommand = SemanticCommandBase<
  "CreateShaderGraph",
  {
    definition: ShaderGraphDocument;
  }
>;

export type RenameShaderGraphCommand = SemanticCommandBase<
  "RenameShaderGraph",
  {
    shaderDefinitionId: string;
    displayName: string;
  }
>;

export type DeleteShaderGraphCommand = SemanticCommandBase<
  "DeleteShaderGraph",
  {
    shaderDefinitionId: string;
  }
>;

export type UpdateShaderNodeCommand = SemanticCommandBase<
  "UpdateShaderNode",
  {
    shaderDefinitionId: string;
    node: ShaderNodeInstance;
  }
>;

export type RemoveShaderNodeCommand = SemanticCommandBase<
  "RemoveShaderNode",
  {
    shaderDefinitionId: string;
    nodeId: string;
  }
>;

export type AddShaderEdgeCommand = SemanticCommandBase<
  "AddShaderEdge",
  {
    shaderDefinitionId: string;
    edge: ShaderEdge;
  }
>;

export type RemoveShaderEdgeCommand = SemanticCommandBase<
  "RemoveShaderEdge",
  {
    shaderDefinitionId: string;
    edgeId: string;
  }
>;

export type UpdateShaderParameterCommand = SemanticCommandBase<
  "UpdateShaderParameter",
  {
    shaderDefinitionId: string;
    parameter: ShaderParameter;
  }
>;

export type RemoveShaderParameterCommand = SemanticCommandBase<
  "RemoveShaderParameter",
  {
    shaderDefinitionId: string;
    parameterId: string;
  }
>;

export type SetAssetDefaultShaderCommand = SemanticCommandBase<
  "SetAssetDefaultShader",
  {
    definitionId: string;
    slot: ShaderSlotKind;
    shaderDefinitionId: string | null;
  }
>;

export type SetAssetDefaultShaderParameterOverrideCommand = SemanticCommandBase<
  "SetAssetDefaultShaderParameterOverride",
  {
    definitionId: string;
    slot: ShaderSlotKind;
    override: ShaderParameterOverride;
  }
>;

export type ClearAssetDefaultShaderParameterOverrideCommand = SemanticCommandBase<
  "ClearAssetDefaultShaderParameterOverride",
  {
    definitionId: string;
    slot: ShaderSlotKind;
    parameterId: string;
  }
>;

export type SetPlacedAssetShaderOverrideCommand = SemanticCommandBase<
  "SetPlacedAssetShaderOverride",
  {
    instanceId: string;
    slot: ShaderSlotKind;
    shaderDefinitionId: string | null;
  }
>;

export type SetNPCPresenceShaderOverrideCommand = SemanticCommandBase<
  "SetNPCPresenceShaderOverride",
  {
    presenceId: string;
    slot: ShaderSlotKind;
    shaderDefinitionId: string | null;
  }
>;

export type SetItemPresenceShaderOverrideCommand = SemanticCommandBase<
  "SetItemPresenceShaderOverride",
  {
    presenceId: string;
    slot: ShaderSlotKind;
    shaderDefinitionId: string | null;
  }
>;

export type SetPlacedAssetShaderParameterOverrideCommand = SemanticCommandBase<
  "SetPlacedAssetShaderParameterOverride",
  {
    instanceId: string;
    slot: ShaderSlotKind;
    override: ShaderParameterOverride;
  }
>;

export type ClearPlacedAssetShaderParameterOverrideCommand = SemanticCommandBase<
  "ClearPlacedAssetShaderParameterOverride",
  {
    instanceId: string;
    slot: ShaderSlotKind;
    parameterId: string;
  }
>;

export type SetNPCPresenceShaderParameterOverrideCommand = SemanticCommandBase<
  "SetNPCPresenceShaderParameterOverride",
  {
    presenceId: string;
    slot: ShaderSlotKind;
    override: ShaderParameterOverride;
  }
>;

export type ClearNPCPresenceShaderParameterOverrideCommand = SemanticCommandBase<
  "ClearNPCPresenceShaderParameterOverride",
  {
    presenceId: string;
    slot: ShaderSlotKind;
    parameterId: string;
  }
>;

export type SetItemPresenceShaderParameterOverrideCommand = SemanticCommandBase<
  "SetItemPresenceShaderParameterOverride",
  {
    presenceId: string;
    slot: ShaderSlotKind;
    override: ShaderParameterOverride;
  }
>;

export type ClearItemPresenceShaderParameterOverrideCommand = SemanticCommandBase<
  "ClearItemPresenceShaderParameterOverride",
  {
    presenceId: string;
    slot: ShaderSlotKind;
    parameterId: string;
  }
>;

export type AddPostProcessShaderCommand = SemanticCommandBase<
  "AddPostProcessShader",
  {
    environmentDefinitionId: string;
    binding: PostProcessShaderBinding;
  }
>;

export type UpdatePostProcessShaderOrderCommand = SemanticCommandBase<
  "UpdatePostProcessShaderOrder",
  {
    environmentDefinitionId: string;
    shaderDefinitionId: string;
    order: number;
  }
>;

export type UpdatePostProcessShaderParameterCommand = SemanticCommandBase<
  "UpdatePostProcessShaderParameter",
  {
    environmentDefinitionId: string;
    shaderDefinitionId: string;
    override: ShaderParameterOverride;
  }
>;

export type TogglePostProcessShaderCommand = SemanticCommandBase<
  "TogglePostProcessShader",
  {
    environmentDefinitionId: string;
    shaderDefinitionId: string;
    enabled: boolean;
  }
>;

export type RemovePostProcessShaderCommand = SemanticCommandBase<
  "RemovePostProcessShader",
  {
    environmentDefinitionId: string;
    shaderDefinitionId: string;
  }
>;

export type UpdatePlayerDefinitionCommand = SemanticCommandBase<
  "UpdatePlayerDefinition",
  {
    definition: PlayerDefinition;
  }
>;

export type CreatePlayerPresenceCommand = SemanticCommandBase<
  "CreatePlayerPresence",
  {
    presenceId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type TransformPlayerPresenceCommand = SemanticCommandBase<
  "TransformPlayerPresence",
  {
    presenceId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type RemovePlayerPresenceCommand = SemanticCommandBase<
  "RemovePlayerPresence",
  {
    presenceId: string;
  }
>;

export type CreateNPCDefinitionCommand = SemanticCommandBase<
  "CreateNPCDefinition",
  {
    definition: NPCDefinition;
  }
>;

export type CreateItemDefinitionCommand = SemanticCommandBase<
  "CreateItemDefinition",
  {
    definition: ItemDefinition;
  }
>;

export type CreateSpellDefinitionCommand = SemanticCommandBase<
  "CreateSpellDefinition",
  {
    definition: SpellDefinition;
  }
>;

export type CreateDocumentDefinitionCommand = SemanticCommandBase<
  "CreateDocumentDefinition",
  {
    definition: DocumentDefinition;
  }
>;

export type CreateDialogueDefinitionCommand = SemanticCommandBase<
  "CreateDialogueDefinition",
  {
    definition: DialogueDefinition;
  }
>;

export type CreateQuestDefinitionCommand = SemanticCommandBase<
  "CreateQuestDefinition",
  {
    definition: QuestDefinition;
  }
>;

export type UpdateNPCDefinitionCommand = SemanticCommandBase<
  "UpdateNPCDefinition",
  {
    definition: NPCDefinition;
  }
>;

export type UpdateItemDefinitionCommand = SemanticCommandBase<
  "UpdateItemDefinition",
  {
    definition: ItemDefinition;
  }
>;

export type UpdateSpellDefinitionCommand = SemanticCommandBase<
  "UpdateSpellDefinition",
  {
    definition: SpellDefinition;
  }
>;

export type UpdateDocumentDefinitionCommand = SemanticCommandBase<
  "UpdateDocumentDefinition",
  {
    definition: DocumentDefinition;
  }
>;

export type UpdateDialogueDefinitionCommand = SemanticCommandBase<
  "UpdateDialogueDefinition",
  {
    definition: DialogueDefinition;
  }
>;

export type UpdateQuestDefinitionCommand = SemanticCommandBase<
  "UpdateQuestDefinition",
  {
    definition: QuestDefinition;
  }
>;

export type DeleteNPCDefinitionCommand = SemanticCommandBase<
  "DeleteNPCDefinition",
  {
    definitionId: string;
  }
>;

export type DeleteItemDefinitionCommand = SemanticCommandBase<
  "DeleteItemDefinition",
  {
    definitionId: string;
  }
>;

export type DeleteSpellDefinitionCommand = SemanticCommandBase<
  "DeleteSpellDefinition",
  {
    definitionId: string;
  }
>;

export type DeleteDocumentDefinitionCommand = SemanticCommandBase<
  "DeleteDocumentDefinition",
  {
    definitionId: string;
  }
>;

export type DeleteDialogueDefinitionCommand = SemanticCommandBase<
  "DeleteDialogueDefinition",
  {
    definitionId: string;
  }
>;

export type DeleteQuestDefinitionCommand = SemanticCommandBase<
  "DeleteQuestDefinition",
  {
    definitionId: string;
  }
>;

export type CreateNPCPresenceCommand = SemanticCommandBase<
  "CreateNPCPresence",
  {
    presenceId: string;
    npcDefinitionId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type CreateItemPresenceCommand = SemanticCommandBase<
  "CreateItemPresence",
  {
    presenceId: string;
    itemDefinitionId: string;
    quantity: number;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type TransformNPCPresenceCommand = SemanticCommandBase<
  "TransformNPCPresence",
  {
    presenceId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type RemoveNPCPresenceCommand = SemanticCommandBase<
  "RemoveNPCPresence",
  {
    presenceId: string;
  }
>;

export type TransformItemPresenceCommand = SemanticCommandBase<
  "TransformItemPresence",
  {
    presenceId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type UpdateItemPresenceCommand = SemanticCommandBase<
  "UpdateItemPresence",
  {
    presenceId: string;
    quantity?: number;
  }
>;

export type RemoveItemPresenceCommand = SemanticCommandBase<
  "RemoveItemPresence",
  {
    presenceId: string;
  }
>;

export type TransformPlacedAssetCommand = SemanticCommandBase<
  "TransformPlacedAsset",
  {
    instanceId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }
>;

export type AssignPlacedAssetInspectableCommand = SemanticCommandBase<
  "AssignPlacedAssetInspectable",
  {
    instanceId: string;
    behaviorId: string;
    documentDefinitionId: string;
    promptText?: string;
  }
>;

export type UpdatePlacedAssetInspectableCommand = SemanticCommandBase<
  "UpdatePlacedAssetInspectable",
  {
    instanceId: string;
    documentDefinitionId?: string;
    promptText?: string;
  }
>;

export type RemovePlacedAssetInspectableCommand = SemanticCommandBase<
  "RemovePlacedAssetInspectable",
  {
    instanceId: string;
  }
>;

export type UpdatePluginConfigurationCommand = SemanticCommandBase<
  "UpdatePluginConfiguration",
  {
    configuration: PluginConfigurationRecord;
  }
>;

export type DeletePluginConfigurationCommand = SemanticCommandBase<
  "DeletePluginConfiguration",
  {
    pluginId: string;
  }
>;

export type UpdateDeploymentSettingsCommand = SemanticCommandBase<
  "UpdateDeploymentSettings",
  {
    settings: DeploymentSettings;
  }
>;

export type SemanticCommand =
  | MovePlacedAssetCommand
  | PlaceAssetInstanceCommand
  | DuplicatePlacedAssetCommand
  | RemovePlacedAssetCommand
  | MovePlacedAssetToFolderCommand
  | CreateSceneFolderCommand
  | RenameSceneFolderCommand
  | DeleteSceneFolderCommand
  | UpdateRegionMetadataCommand
  | CreateRegionAreaCommand
  | UpdateRegionAreaCommand
  | DeleteRegionAreaCommand
  | CreateRegionNPCBehaviorCommand
  | UpdateRegionNPCBehaviorCommand
  | DeleteRegionNPCBehaviorCommand
  | CreateLandscapeChannelCommand
  | UpdateLandscapeChannelCommand
  | TransformPlacedAssetCommand
  | PaintLandscapeCommand
  | ConfigureLandscapeCommand
  | UpdateEnvironmentDefinitionCommand
  | CreateShaderGraphCommand
  | RenameShaderGraphCommand
  | DeleteShaderGraphCommand
  | UpdateShaderNodeCommand
  | RemoveShaderNodeCommand
  | AddShaderEdgeCommand
  | RemoveShaderEdgeCommand
  | UpdateShaderParameterCommand
  | RemoveShaderParameterCommand
  | SetAssetDefaultShaderCommand
  | SetAssetDefaultShaderParameterOverrideCommand
  | ClearAssetDefaultShaderParameterOverrideCommand
  | SetPlacedAssetShaderOverrideCommand
  | SetNPCPresenceShaderOverrideCommand
  | SetItemPresenceShaderOverrideCommand
  | SetPlacedAssetShaderParameterOverrideCommand
  | ClearPlacedAssetShaderParameterOverrideCommand
  | SetNPCPresenceShaderParameterOverrideCommand
  | ClearNPCPresenceShaderParameterOverrideCommand
  | SetItemPresenceShaderParameterOverrideCommand
  | ClearItemPresenceShaderParameterOverrideCommand
  | AddPostProcessShaderCommand
  | UpdatePostProcessShaderOrderCommand
  | UpdatePostProcessShaderParameterCommand
  | TogglePostProcessShaderCommand
  | RemovePostProcessShaderCommand
  | UpdatePlayerDefinitionCommand
  | CreatePlayerPresenceCommand
  | TransformPlayerPresenceCommand
  | RemovePlayerPresenceCommand
  | CreateNPCDefinitionCommand
  | CreateSpellDefinitionCommand
  | CreateItemDefinitionCommand
  | CreateDocumentDefinitionCommand
  | CreateDialogueDefinitionCommand
  | CreateQuestDefinitionCommand
  | UpdateNPCDefinitionCommand
  | UpdateSpellDefinitionCommand
  | UpdateItemDefinitionCommand
  | UpdateDocumentDefinitionCommand
  | UpdateDialogueDefinitionCommand
  | UpdateQuestDefinitionCommand
  | DeleteNPCDefinitionCommand
  | DeleteSpellDefinitionCommand
  | DeleteItemDefinitionCommand
  | DeleteDocumentDefinitionCommand
  | DeleteDialogueDefinitionCommand
  | DeleteQuestDefinitionCommand
  | CreateNPCPresenceCommand
  | CreateItemPresenceCommand
  | TransformNPCPresenceCommand
  | TransformItemPresenceCommand
  | UpdateItemPresenceCommand
  | RemoveNPCPresenceCommand
  | RemoveItemPresenceCommand
  | AssignPlacedAssetInspectableCommand
  | UpdatePlacedAssetInspectableCommand
  | RemovePlacedAssetInspectableCommand
  | UpdatePluginConfigurationCommand
  | DeletePluginConfigurationCommand
  | UpdateDeploymentSettingsCommand;

export {
  executeCommand,
  pushTransaction,
  undoTransaction,
  createEmptyHistory,
  type CommandExecutionResult
} from "./executor";
