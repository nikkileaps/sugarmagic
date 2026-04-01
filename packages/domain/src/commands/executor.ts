/**
 * Command executor: applies semantic commands to canonical documents.
 *
 * Intent → Command → Validation → Transaction → Canonical Mutation.
 * This is the single mutation boundary per ADR 004.
 */

import type { RegionDocument } from "../region-authoring";
import type { TransactionBoundary } from "../transactions";
import type { AuthoringHistory } from "../history";
import type { TimestampIso } from "../shared";
import type { SemanticCommand, MovePlacedAssetCommand, TransformPlacedAssetCommand } from "./index";

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
