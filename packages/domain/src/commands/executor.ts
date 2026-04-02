/**
 * Command executor: applies semantic commands to canonical documents.
 *
 * Intent → Command → Validation → Transaction → Canonical Mutation.
 * This is the single mutation boundary per ADR 004.
 */

import type { RegionDocument, PlacedAssetInstance, RegionSceneFolder } from "../region-authoring";
import type { TransactionBoundary } from "../transactions";
import type { AuthoringHistory } from "../history";
import type { TimestampIso } from "../shared";
import type {
  SemanticCommand,
  MovePlacedAssetCommand,
  TransformPlacedAssetCommand,
  PlaceAssetInstanceCommand,
  DuplicatePlacedAssetCommand,
  RemovePlacedAssetCommand,
  MovePlacedAssetToFolderCommand,
  CreateSceneFolderCommand,
  RenameSceneFolderCommand,
  DeleteSceneFolderCommand
} from "./index";

export interface CommandExecutionResult {
  region: RegionDocument;
  transaction: TransactionBoundary;
}

let txCounter = 0;

function nextTransactionId(): string {
  return `tx-${++txCounter}-${Date.now()}`;
}

function applyMovePlacedAsset(
  region: RegionDocument,
  command: MovePlacedAssetCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              transform: {
                ...asset.transform,
                position: command.payload.position
              }
            }
          : asset
      )
    }
  };
}

function applyTransformPlacedAsset(
  region: RegionDocument,
  command: TransformPlacedAssetCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              transform: {
                position: command.payload.position,
                rotation: command.payload.rotation,
                scale: command.payload.scale
              }
            }
          : asset
      )
    }
  };
}

function createPlacedAssetFromCommand(
  command: PlaceAssetInstanceCommand
): PlacedAssetInstance {
  return {
    instanceId: command.payload.instanceId,
    assetDefinitionId: command.payload.assetDefinitionId,
    displayName: command.payload.displayName,
    parentFolderId: command.payload.parentFolderId,
    transform: {
      position: command.payload.position,
      rotation: command.payload.rotation,
      scale: command.payload.scale
    }
  };
}

function applyPlaceAssetInstance(
  region: RegionDocument,
  command: PlaceAssetInstanceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: [...region.scene.placedAssets, createPlacedAssetFromCommand(command)]
    }
  };
}

function applyDuplicatePlacedAsset(
  region: RegionDocument,
  command: DuplicatePlacedAssetCommand
): RegionDocument {
  const source = region.scene.placedAssets.find(
    (asset) => asset.instanceId === command.payload.sourceInstanceId
  );
  if (!source) {
    return region;
  }

  const duplicated: PlacedAssetInstance = {
    ...source,
    instanceId: command.payload.duplicatedInstanceId,
    displayName: `${source.displayName} Copy`,
    transform: {
      position: [
        source.transform.position[0] + command.payload.positionOffset[0],
        source.transform.position[1] + command.payload.positionOffset[1],
        source.transform.position[2] + command.payload.positionOffset[2]
      ],
      rotation: [...source.transform.rotation] as [number, number, number],
      scale: [...source.transform.scale] as [number, number, number]
    }
  };

  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: [...region.scene.placedAssets, duplicated]
    }
  };
}

function applyRemovePlacedAsset(
  region: RegionDocument,
  command: RemovePlacedAssetCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.filter(
        (asset) => asset.instanceId !== command.payload.instanceId
      )
    }
  };
}

function applyMovePlacedAssetToFolder(
  region: RegionDocument,
  command: MovePlacedAssetToFolderCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              parentFolderId: command.payload.parentFolderId
            }
          : asset
      )
    }
  };
}

function createFolderFromCommand(
  command: CreateSceneFolderCommand
): RegionSceneFolder {
  return {
    folderId: command.payload.folderId,
    displayName: command.payload.displayName,
    parentFolderId: command.payload.parentFolderId
  };
}

function applyCreateSceneFolder(
  region: RegionDocument,
  command: CreateSceneFolderCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      folders: [...region.scene.folders, createFolderFromCommand(command)]
    }
  };
}

function applyRenameSceneFolder(
  region: RegionDocument,
  command: RenameSceneFolderCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      folders: region.scene.folders.map((folder) =>
        folder.folderId === command.payload.folderId
          ? {
              ...folder,
              displayName: command.payload.displayName
            }
          : folder
      )
    }
  };
}

function applyDeleteSceneFolder(
  region: RegionDocument,
  command: DeleteSceneFolderCommand
): RegionDocument {
  const folder = region.scene.folders.find(
    (candidate) => candidate.folderId === command.payload.folderId
  );
  if (!folder) {
    return region;
  }

  return {
    ...region,
    scene: {
      ...region.scene,
      folders: region.scene.folders
        .filter((candidate) => candidate.folderId !== command.payload.folderId)
        .map((candidate) =>
          candidate.parentFolderId === command.payload.folderId
            ? {
                ...candidate,
                parentFolderId: folder.parentFolderId
              }
            : candidate
        ),
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.parentFolderId === command.payload.folderId
          ? {
              ...asset,
              parentFolderId: folder.parentFolderId
            }
          : asset
      )
    }
  };
}

export function executeCommand(
  region: RegionDocument,
  command: SemanticCommand
): CommandExecutionResult {
  let updatedRegion: RegionDocument;

  switch (command.kind) {
    case "MovePlacedAsset":
      updatedRegion = applyMovePlacedAsset(region, command);
      break;
    case "TransformPlacedAsset":
      updatedRegion = applyTransformPlacedAsset(region, command);
      break;
    case "PlaceAssetInstance":
      updatedRegion = applyPlaceAssetInstance(region, command);
      break;
    case "DuplicatePlacedAsset":
      updatedRegion = applyDuplicatePlacedAsset(region, command);
      break;
    case "RemovePlacedAsset":
      updatedRegion = applyRemovePlacedAsset(region, command);
      break;
    case "MovePlacedAssetToFolder":
      updatedRegion = applyMovePlacedAssetToFolder(region, command);
      break;
    case "CreateSceneFolder":
      updatedRegion = applyCreateSceneFolder(region, command);
      break;
    case "RenameSceneFolder":
      updatedRegion = applyRenameSceneFolder(region, command);
      break;
    case "DeleteSceneFolder":
      updatedRegion = applyDeleteSceneFolder(region, command);
      break;
    default:
      throw new Error(`Unsupported command kind: ${command.kind}`);
  }

  const transaction: TransactionBoundary = {
    transactionId: nextTransactionId(),
    command,
    affectedAggregateIds: [region.identity.id],
    committedAt: new Date().toISOString() as TimestampIso
  };

  return { region: updatedRegion, transaction };
}

export function pushTransaction(
  history: AuthoringHistory,
  transaction: TransactionBoundary
): AuthoringHistory {
  return {
    undoStack: [...history.undoStack, transaction],
    redoStack: []
  };
}

export function undoTransaction(
  history: AuthoringHistory,
  region: RegionDocument,
  previousRegions: RegionDocument[]
): { history: AuthoringHistory; region: RegionDocument } | null {
  if (history.undoStack.length === 0) return null;

  const popped = history.undoStack[history.undoStack.length - 1];
  const previousRegion =
    previousRegions[history.undoStack.length - 1] ?? region;

  return {
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, popped]
    },
    region: previousRegion
  };
}

export function createEmptyHistory(): AuthoringHistory {
  return { undoStack: [], redoStack: [] };
}
