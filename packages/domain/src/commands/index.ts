import type { DocumentDefinition } from "../document-definition";
import type {
  RegionLandscapeChannelDefinition,
  RegionLandscapePaintPayload
} from "../region-authoring";
import type { EnvironmentDefinition } from "../content-library";
import type { DialogueDefinition } from "../dialogue-definition";
import type { ItemDefinition } from "../item-definition";
import type { NPCDefinition } from "../npc-definition";
import type { PlayerDefinition } from "../player-definition";
import type { QuestDefinition } from "../quest-definition";
import type { DocumentId, SubjectReference } from "../shared/identity";

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

export type CreateLandscapeChannelCommand = SemanticCommandBase<
  "CreateLandscapeChannel",
  {
    channel: RegionLandscapeChannelDefinition;
  }
>;

export type UpdateLandscapeChannelCommand = SemanticCommandBase<
  "UpdateLandscapeChannel",
  {
    channelId: string;
    displayName?: string;
    mode?: RegionLandscapeChannelDefinition["mode"];
    color?: number;
    materialDefinitionId?: string | null;
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
    pluginId: string;
    enabled: boolean;
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
  | CreateLandscapeChannelCommand
  | UpdateLandscapeChannelCommand
  | TransformPlacedAssetCommand
  | PaintLandscapeCommand
  | ConfigureLandscapeCommand
  | UpdateEnvironmentDefinitionCommand
  | UpdatePlayerDefinitionCommand
  | CreatePlayerPresenceCommand
  | TransformPlayerPresenceCommand
  | RemovePlayerPresenceCommand
  | CreateNPCDefinitionCommand
  | CreateItemDefinitionCommand
  | CreateDocumentDefinitionCommand
  | CreateDialogueDefinitionCommand
  | CreateQuestDefinitionCommand
  | UpdateNPCDefinitionCommand
  | UpdateItemDefinitionCommand
  | UpdateDocumentDefinitionCommand
  | UpdateDialogueDefinitionCommand
  | UpdateQuestDefinitionCommand
  | DeleteNPCDefinitionCommand
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
  | UpdatePluginConfigurationCommand;

export {
  executeCommand,
  pushTransaction,
  undoTransaction,
  createEmptyHistory,
  type CommandExecutionResult
} from "./executor";
