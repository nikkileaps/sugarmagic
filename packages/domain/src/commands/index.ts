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

export type PaintLandscapeCommand = SemanticCommandBase<
  "PaintLandscape",
  {
    channelId: string;
    affectedBounds: [number, number, number, number];
  }
>;

export type UpdateEnvironmentCommand = SemanticCommandBase<
  "UpdateEnvironment",
  {
    skyProfileId: string | null;
    fogEnabled: boolean;
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

export type UpdatePluginConfigurationCommand = SemanticCommandBase<
  "UpdatePluginConfiguration",
  {
    pluginId: string;
    enabled: boolean;
  }
>;

export type SemanticCommand =
  | MovePlacedAssetCommand
  | TransformPlacedAssetCommand
  | PaintLandscapeCommand
  | UpdateEnvironmentCommand
  | UpdatePluginConfigurationCommand;

export {
  executeCommand,
  pushTransaction,
  undoTransaction,
  createEmptyHistory,
  type CommandExecutionResult
} from "./executor";
