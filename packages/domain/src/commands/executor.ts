/**
 * Command executor: applies semantic commands to canonical documents.
 *
 * Intent → Command → Validation → Transaction → Canonical Mutation.
 * This is the single mutation boundary per ADR 004.
 */

import {
  createRegionAreaDefinition,
  createRegionNPCBehaviorDefinition,
  MAX_REGION_LANDSCAPE_CHANNELS
} from "../region-authoring";
import type {
  RegionDocument,
  PlacedAssetInstance,
  RegionInspectableBehavior,
  RegionSceneFolder,
  RegionNPCPresence,
  RegionPlayerPresence,
  RegionItemPresence
} from "../region-authoring";
import type { LandscapeSurfaceSlot } from "../surface";
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
  DeleteSceneFolderCommand,
  CreateRegionAreaCommand,
  UpdateRegionAreaCommand,
  DeleteRegionAreaCommand,
  CreateRegionNPCBehaviorCommand,
  UpdateRegionNPCBehaviorCommand,
  DeleteRegionNPCBehaviorCommand,
  CreateLandscapeChannelCommand,
  UpdateLandscapeChannelCommand,
  PaintLandscapeCommand,
  ConfigureLandscapeCommand,
  CreatePlayerPresenceCommand,
  TransformPlayerPresenceCommand,
  RemovePlayerPresenceCommand,
  CreateNPCPresenceCommand,
  TransformNPCPresenceCommand,
  RemoveNPCPresenceCommand,
  CreateItemPresenceCommand,
  TransformItemPresenceCommand,
  UpdateItemPresenceCommand,
  RemoveItemPresenceCommand,
  AssignPlacedAssetInspectableCommand,
  UpdatePlacedAssetInspectableCommand,
  RemovePlacedAssetInspectableCommand,
  UpdateRegionMetadataCommand,
  SetPlacedAssetShaderOverrideCommand,
  SetPlacedAssetShaderParameterOverrideCommand,
  ClearPlacedAssetShaderParameterOverrideCommand,
  SetNPCPresenceShaderOverrideCommand,
  SetNPCPresenceShaderParameterOverrideCommand,
  ClearNPCPresenceShaderParameterOverrideCommand,
  SetItemPresenceShaderOverrideCommand,
  SetItemPresenceShaderParameterOverrideCommand,
  ClearItemPresenceShaderParameterOverrideCommand
} from "./index";
import type {
  ShaderBindingOverride,
  ShaderParameterOverride,
  ShaderSlotKind
} from "../shader-graph";

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
    inspectable: null,
    shaderOverrides: [],
    shaderParameterOverrides: [],
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

function createInspectableBehaviorFromCommand(
  command: AssignPlacedAssetInspectableCommand
): RegionInspectableBehavior {
  return {
    behaviorId: command.payload.behaviorId,
    documentDefinitionId: command.payload.documentDefinitionId,
    ...(command.payload.promptText === undefined
      ? {}
      : { promptText: command.payload.promptText })
  };
}

function applyAssignPlacedAssetInspectable(
  region: RegionDocument,
  command: AssignPlacedAssetInspectableCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              inspectable: createInspectableBehaviorFromCommand(command)
            }
          : asset
      )
    }
  };
}

function applyUpdatePlacedAssetInspectable(
  region: RegionDocument,
  command: UpdatePlacedAssetInspectableCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) => {
        if (asset.instanceId !== command.payload.instanceId || !asset.inspectable) {
          return asset;
        }

        return {
          ...asset,
          inspectable: {
            ...asset.inspectable,
            ...(command.payload.documentDefinitionId === undefined
              ? {}
              : { documentDefinitionId: command.payload.documentDefinitionId }),
            ...(command.payload.promptText === undefined
              ? {}
              : {
                  promptText:
                    command.payload.promptText.trim().length > 0
                      ? command.payload.promptText
                      : undefined
                })
          }
        };
      })
    }
  };
}

function applyRemovePlacedAssetInspectable(
  region: RegionDocument,
  command: RemovePlacedAssetInspectableCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              inspectable: null
            }
          : asset
      )
    }
  };
}

function createPlayerPresenceFromCommand(
  command: CreatePlayerPresenceCommand
): RegionPlayerPresence {
  return {
    presenceId: command.payload.presenceId,
    transform: {
      position: command.payload.position,
      rotation: command.payload.rotation,
      scale: command.payload.scale
    }
  };
}

function applyCreatePlayerPresence(
  region: RegionDocument,
  command: CreatePlayerPresenceCommand
): RegionDocument {
  if (region.scene.playerPresence) {
    return region;
  }

  return {
    ...region,
    scene: {
      ...region.scene,
      playerPresence: createPlayerPresenceFromCommand(command)
    }
  };
}

function applyTransformPlayerPresence(
  region: RegionDocument,
  command: TransformPlayerPresenceCommand
): RegionDocument {
  if (!region.scene.playerPresence) {
    return region;
  }

  return {
    ...region,
    scene: {
      ...region.scene,
      playerPresence:
        region.scene.playerPresence.presenceId === command.payload.presenceId
          ? {
              ...region.scene.playerPresence,
              transform: {
                position: command.payload.position,
                rotation: command.payload.rotation,
                scale: command.payload.scale
              }
            }
          : region.scene.playerPresence
    }
  };
}

function applyRemovePlayerPresence(
  region: RegionDocument,
  command: RemovePlayerPresenceCommand
): RegionDocument {
  if (region.scene.playerPresence?.presenceId !== command.payload.presenceId) {
    return region;
  }

  return {
    ...region,
    scene: {
      ...region.scene,
      playerPresence: null
    }
  };
}

function createNPCPresenceFromCommand(
  command: CreateNPCPresenceCommand
): RegionNPCPresence {
  return {
    presenceId: command.payload.presenceId,
    npcDefinitionId: command.payload.npcDefinitionId,
    shaderOverrides: [],
    shaderParameterOverrides: [],
    transform: {
      position: command.payload.position,
      rotation: command.payload.rotation,
      scale: command.payload.scale
    }
  };
}

function createItemPresenceFromCommand(
  command: CreateItemPresenceCommand
): RegionItemPresence {
  return {
    presenceId: command.payload.presenceId,
    itemDefinitionId: command.payload.itemDefinitionId,
    quantity: Math.max(1, Math.floor(command.payload.quantity)),
    shaderOverrides: [],
    shaderParameterOverrides: [],
    transform: {
      position: command.payload.position,
      rotation: command.payload.rotation,
      scale: command.payload.scale
    }
  };
}

function upsertShaderParameterOverride(
  overrides: ShaderParameterOverride[],
  nextOverride: ShaderParameterOverride
): ShaderParameterOverride[] {
  const index = overrides.findIndex(
    (override) =>
      override.parameterId === nextOverride.parameterId &&
      override.slot === nextOverride.slot
  );
  if (index < 0) {
    return [...overrides, nextOverride];
  }

  const next = [...overrides];
  next[index] = nextOverride;
  return next;
}

function upsertShaderBindingOverride(
  overrides: ShaderBindingOverride[],
  nextOverride: { shaderDefinitionId: string; slot: ShaderSlotKind }
): ShaderBindingOverride[] {
  const next = overrides.filter((override) => override.slot !== nextOverride.slot);
  next.push(nextOverride);
  return next;
}

function applySetPlacedAssetShaderOverride(
  region: RegionDocument,
  command: SetPlacedAssetShaderOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              shaderOverrides: command.payload.shaderDefinitionId
                ? upsertShaderBindingOverride(asset.shaderOverrides ?? [], {
                    shaderDefinitionId: command.payload.shaderDefinitionId,
                    slot: command.payload.slot
                  })
                : (asset.shaderOverrides ?? []).filter(
                    (override) => override.slot !== command.payload.slot
                  )
            }
          : asset
      )
    }
  };
}

function applySetPlacedAssetShaderParameterOverride(
  region: RegionDocument,
  command: SetPlacedAssetShaderParameterOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              shaderParameterOverrides: upsertShaderParameterOverride(
                asset.shaderParameterOverrides,
                { ...command.payload.override, slot: command.payload.override.slot ?? command.payload.slot }
              )
            }
          : asset
      )
    }
  };
}

function applyClearPlacedAssetShaderParameterOverride(
  region: RegionDocument,
  command: ClearPlacedAssetShaderParameterOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      placedAssets: region.scene.placedAssets.map((asset) =>
        asset.instanceId === command.payload.instanceId
          ? {
              ...asset,
              shaderParameterOverrides: asset.shaderParameterOverrides.filter(
                (override) =>
                  !(
                    override.parameterId === command.payload.parameterId &&
                    override.slot === command.payload.slot
                  )
              )
            }
          : asset
      )
    }
  };
}

function applySetNPCPresenceShaderOverride(
  region: RegionDocument,
  command: SetNPCPresenceShaderOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      npcPresences: region.scene.npcPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              shaderOverrides: command.payload.shaderDefinitionId
                ? upsertShaderBindingOverride(presence.shaderOverrides ?? [], {
                    shaderDefinitionId: command.payload.shaderDefinitionId,
                    slot: command.payload.slot
                  })
                : (presence.shaderOverrides ?? []).filter(
                    (override) => override.slot !== command.payload.slot
                  )
            }
          : presence
      )
    }
  };
}

function applySetNPCPresenceShaderParameterOverride(
  region: RegionDocument,
  command: SetNPCPresenceShaderParameterOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      npcPresences: region.scene.npcPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              shaderParameterOverrides: upsertShaderParameterOverride(
                presence.shaderParameterOverrides,
                { ...command.payload.override, slot: command.payload.override.slot ?? command.payload.slot }
              )
            }
          : presence
      )
    }
  };
}

function applyClearNPCPresenceShaderParameterOverride(
  region: RegionDocument,
  command: ClearNPCPresenceShaderParameterOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      npcPresences: region.scene.npcPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              shaderParameterOverrides: presence.shaderParameterOverrides.filter(
                (override) =>
                  !(
                    override.parameterId === command.payload.parameterId &&
                    override.slot === command.payload.slot
                  )
              )
            }
          : presence
      )
    }
  };
}

function applySetItemPresenceShaderOverride(
  region: RegionDocument,
  command: SetItemPresenceShaderOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: region.scene.itemPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              shaderOverrides: command.payload.shaderDefinitionId
                ? upsertShaderBindingOverride(presence.shaderOverrides ?? [], {
                    shaderDefinitionId: command.payload.shaderDefinitionId,
                    slot: command.payload.slot
                  })
                : (presence.shaderOverrides ?? []).filter(
                    (override) => override.slot !== command.payload.slot
                  )
            }
          : presence
      )
    }
  };
}

function applySetItemPresenceShaderParameterOverride(
  region: RegionDocument,
  command: SetItemPresenceShaderParameterOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: region.scene.itemPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              shaderParameterOverrides: upsertShaderParameterOverride(
                presence.shaderParameterOverrides,
                { ...command.payload.override, slot: command.payload.override.slot ?? command.payload.slot }
              )
            }
          : presence
      )
    }
  };
}

function applyClearItemPresenceShaderParameterOverride(
  region: RegionDocument,
  command: ClearItemPresenceShaderParameterOverrideCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: region.scene.itemPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              shaderParameterOverrides: presence.shaderParameterOverrides.filter(
                (override) =>
                  !(
                    override.parameterId === command.payload.parameterId &&
                    override.slot === command.payload.slot
                  )
              )
            }
          : presence
      )
    }
  };
}

function applyCreateNPCPresence(
  region: RegionDocument,
  command: CreateNPCPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      npcPresences: [...region.scene.npcPresences, createNPCPresenceFromCommand(command)]
    }
  };
}

function applyTransformNPCPresence(
  region: RegionDocument,
  command: TransformNPCPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      npcPresences: region.scene.npcPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              transform: {
                position: command.payload.position,
                rotation: command.payload.rotation,
                scale: command.payload.scale
              }
            }
          : presence
      )
    }
  };
}

function applyRemoveNPCPresence(
  region: RegionDocument,
  command: RemoveNPCPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      npcPresences: region.scene.npcPresences.filter(
        (presence) => presence.presenceId !== command.payload.presenceId
      )
    }
  };
}

function applyCreateItemPresence(
  region: RegionDocument,
  command: CreateItemPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: [...region.scene.itemPresences, createItemPresenceFromCommand(command)]
    }
  };
}

function applyTransformItemPresence(
  region: RegionDocument,
  command: TransformItemPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: region.scene.itemPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              transform: {
                position: command.payload.position,
                rotation: command.payload.rotation,
                scale: command.payload.scale
              }
            }
          : presence
      )
    }
  };
}

function applyUpdateItemPresence(
  region: RegionDocument,
  command: UpdateItemPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: region.scene.itemPresences.map((presence) =>
        presence.presenceId === command.payload.presenceId
          ? {
              ...presence,
              quantity:
                command.payload.quantity === undefined
                  ? presence.quantity
                  : Math.max(1, Math.floor(command.payload.quantity))
            }
          : presence
      )
    }
  };
}

function applyRemoveItemPresence(
  region: RegionDocument,
  command: RemoveItemPresenceCommand
): RegionDocument {
  return {
    ...region,
    scene: {
      ...region.scene,
      itemPresences: region.scene.itemPresences.filter(
        (presence) => presence.presenceId !== command.payload.presenceId
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

function applyUpdateRegionMetadata(
  region: RegionDocument,
  command: UpdateRegionMetadataCommand
): RegionDocument {
  return {
    ...region,
    ...(command.payload.displayName === undefined
      ? {}
      : { displayName: command.payload.displayName }),
    ...(command.payload.lorePageId === undefined
      ? {}
      : {
          lorePageId:
            typeof command.payload.lorePageId === "string" &&
            command.payload.lorePageId.trim().length > 0
              ? command.payload.lorePageId.trim()
              : null
        })
  };
}

function applyCreateRegionArea(
  region: RegionDocument,
  command: CreateRegionAreaCommand
): RegionDocument {
  return {
    ...region,
    areas: [
      ...region.areas,
      createRegionAreaDefinition({
        areaId: command.payload.areaId,
        displayName: command.payload.displayName,
        lorePageId: command.payload.lorePageId,
        parentAreaId: command.payload.parentAreaId,
        kind: command.payload.kind,
        bounds: command.payload.bounds
      })
    ]
  };
}

function applyUpdateRegionArea(
  region: RegionDocument,
  command: UpdateRegionAreaCommand
): RegionDocument {
  return {
    ...region,
    areas: region.areas.map((area) =>
      area.areaId !== command.payload.areaId
        ? area
        : createRegionAreaDefinition({
            ...area,
            ...(command.payload.displayName === undefined
              ? {}
              : { displayName: command.payload.displayName }),
            ...(command.payload.lorePageId === undefined
              ? {}
              : { lorePageId: command.payload.lorePageId }),
            ...(command.payload.parentAreaId === undefined
              ? {}
              : { parentAreaId: command.payload.parentAreaId }),
            ...(command.payload.kind === undefined
              ? {}
              : { kind: command.payload.kind }),
            ...(command.payload.bounds === undefined
              ? {}
              : { bounds: command.payload.bounds })
          })
    )
  };
}

function applyDeleteRegionArea(
  region: RegionDocument,
  command: DeleteRegionAreaCommand
): RegionDocument {
  const deletedAreaId = command.payload.areaId;
  return {
    ...region,
    areas: region.areas
      .filter((area) => area.areaId !== deletedAreaId)
      .map((area) =>
        area.parentAreaId === deletedAreaId
          ? {
              ...area,
              parentAreaId: null
            }
          : area
      )
  };
}

function applyCreateRegionNPCBehavior(
  region: RegionDocument,
  command: CreateRegionNPCBehaviorCommand
): RegionDocument {
  return {
    ...region,
    behaviors: [
      ...region.behaviors,
      createRegionNPCBehaviorDefinition(command.payload.behavior)
    ]
  };
}

function applyUpdateRegionNPCBehavior(
  region: RegionDocument,
  command: UpdateRegionNPCBehaviorCommand
): RegionDocument {
  return {
    ...region,
    behaviors: region.behaviors.map((behavior) =>
      behavior.behaviorId === command.payload.behavior.behaviorId
        ? createRegionNPCBehaviorDefinition(command.payload.behavior)
        : behavior
    )
  };
}

function applyDeleteRegionNPCBehavior(
  region: RegionDocument,
  command: DeleteRegionNPCBehaviorCommand
): RegionDocument {
  return {
    ...region,
    behaviors: region.behaviors.filter(
      (behavior) => behavior.behaviorId !== command.payload.behaviorId
    )
  };
}

function applyCreateLandscapeChannel(
  region: RegionDocument,
  command: CreateLandscapeChannelCommand
): RegionDocument {
  if (region.landscape.surfaceSlots.length >= MAX_REGION_LANDSCAPE_CHANNELS) {
    return region;
  }

  return {
    ...region,
    landscape: {
      ...region.landscape,
      surfaceSlots: [...region.landscape.surfaceSlots, command.payload.channel]
    }
  };
}

function updateLandscapeChannel(
  channel: LandscapeSurfaceSlot,
  command: UpdateLandscapeChannelCommand
): LandscapeSurfaceSlot {
  return {
    ...channel,
    ...(command.payload.displayName === undefined
      ? {}
      : {
          displayName: command.payload.displayName,
          slotName: command.payload.slotName ?? command.payload.displayName
        }),
    ...(command.payload.slotName === undefined ? {} : { slotName: command.payload.slotName }),
    ...(command.payload.surface === undefined ? {} : { surface: command.payload.surface }),
    ...(command.payload.tilingScale === undefined
      ? {}
      : { tilingScale: command.payload.tilingScale })
  };
}

function applyUpdateLandscapeChannel(
  region: RegionDocument,
  command: UpdateLandscapeChannelCommand
): RegionDocument {
  return {
    ...region,
    landscape: {
      ...region.landscape,
      surfaceSlots: region.landscape.surfaceSlots.map((channel) =>
        channel.channelId === command.payload.channelId
          ? updateLandscapeChannel(channel, command)
          : channel
      )
    }
  };
}

function applyPaintLandscape(
  region: RegionDocument,
  command: PaintLandscapeCommand
): RegionDocument {
  return {
    ...region,
    landscape: {
      ...region.landscape,
      paintPayload: command.payload.paintPayload
    }
  };
}

function applyConfigureLandscape(
  region: RegionDocument,
  command: ConfigureLandscapeCommand
): RegionDocument {
  return {
    ...region,
    landscape: {
      ...region.landscape,
      ...(command.payload.enabled === undefined
        ? {}
        : { enabled: command.payload.enabled }),
      ...(command.payload.size === undefined
        ? {}
        : { size: command.payload.size }),
      ...(command.payload.subdivisions === undefined
        ? {}
        : { subdivisions: command.payload.subdivisions })
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
    case "AssignPlacedAssetInspectable":
      updatedRegion = applyAssignPlacedAssetInspectable(region, command);
      break;
    case "UpdatePlacedAssetInspectable":
      updatedRegion = applyUpdatePlacedAssetInspectable(region, command);
      break;
    case "RemovePlacedAssetInspectable":
      updatedRegion = applyRemovePlacedAssetInspectable(region, command);
      break;
    case "SetPlacedAssetShaderOverride":
      updatedRegion = applySetPlacedAssetShaderOverride(region, command);
      break;
    case "SetPlacedAssetShaderParameterOverride":
      updatedRegion = applySetPlacedAssetShaderParameterOverride(region, command);
      break;
    case "ClearPlacedAssetShaderParameterOverride":
      updatedRegion = applyClearPlacedAssetShaderParameterOverride(region, command);
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
    case "UpdateRegionMetadata":
      updatedRegion = applyUpdateRegionMetadata(region, command);
      break;
    case "CreateRegionArea":
      updatedRegion = applyCreateRegionArea(region, command);
      break;
    case "UpdateRegionArea":
      updatedRegion = applyUpdateRegionArea(region, command);
      break;
    case "DeleteRegionArea":
      updatedRegion = applyDeleteRegionArea(region, command);
      break;
    case "CreateRegionNPCBehavior":
      updatedRegion = applyCreateRegionNPCBehavior(region, command);
      break;
    case "UpdateRegionNPCBehavior":
      updatedRegion = applyUpdateRegionNPCBehavior(region, command);
      break;
    case "DeleteRegionNPCBehavior":
      updatedRegion = applyDeleteRegionNPCBehavior(region, command);
      break;
    case "CreateLandscapeChannel":
      updatedRegion = applyCreateLandscapeChannel(region, command);
      break;
    case "UpdateLandscapeChannel":
      updatedRegion = applyUpdateLandscapeChannel(region, command);
      break;
    case "PaintLandscape":
      updatedRegion = applyPaintLandscape(region, command);
      break;
    case "ConfigureLandscape":
      updatedRegion = applyConfigureLandscape(region, command);
      break;
    case "CreatePlayerPresence":
      updatedRegion = applyCreatePlayerPresence(region, command);
      break;
    case "TransformPlayerPresence":
      updatedRegion = applyTransformPlayerPresence(region, command);
      break;
    case "RemovePlayerPresence":
      updatedRegion = applyRemovePlayerPresence(region, command);
      break;
    case "CreateNPCPresence":
      updatedRegion = applyCreateNPCPresence(region, command);
      break;
    case "TransformNPCPresence":
      updatedRegion = applyTransformNPCPresence(region, command);
      break;
    case "SetNPCPresenceShaderOverride":
      updatedRegion = applySetNPCPresenceShaderOverride(region, command);
      break;
    case "SetNPCPresenceShaderParameterOverride":
      updatedRegion = applySetNPCPresenceShaderParameterOverride(region, command);
      break;
    case "ClearNPCPresenceShaderParameterOverride":
      updatedRegion = applyClearNPCPresenceShaderParameterOverride(region, command);
      break;
    case "RemoveNPCPresence":
      updatedRegion = applyRemoveNPCPresence(region, command);
      break;
    case "CreateItemPresence":
      updatedRegion = applyCreateItemPresence(region, command);
      break;
    case "TransformItemPresence":
      updatedRegion = applyTransformItemPresence(region, command);
      break;
    case "UpdateItemPresence":
      updatedRegion = applyUpdateItemPresence(region, command);
      break;
    case "SetItemPresenceShaderOverride":
      updatedRegion = applySetItemPresenceShaderOverride(region, command);
      break;
    case "SetItemPresenceShaderParameterOverride":
      updatedRegion = applySetItemPresenceShaderParameterOverride(region, command);
      break;
    case "ClearItemPresenceShaderParameterOverride":
      updatedRegion = applyClearItemPresenceShaderParameterOverride(region, command);
      break;
    case "RemoveItemPresence":
      updatedRegion = applyRemoveItemPresence(region, command);
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
