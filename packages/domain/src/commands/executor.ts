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
  BrushPlaceAssetsCommand,
  BrushEraseAssetsCommand,
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
  DeleteLandscapeChannelCommand,
  PaintLandscapeCommand,
  ConfigureLandscapeCommand,
  UpdateRegionLayoutSketchCommand,
  CreateRegionSoundEmitterCommand,
  UpdateRegionSoundEmitterCommand,
  DeleteRegionSoundEmitterCommand,
  CreateRegionAmbienceZoneCommand,
  UpdateRegionAmbienceZoneCommand,
  DeleteRegionAmbienceZoneCommand,
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
  SetPlacedAssetSurfaceSlotOverrideCommand,
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
import {
  createRegionSceneOverlay,
  type RegionSceneOverlay,
  type Scene
} from "../scenes";

/**
 * Plan 058 §058.1 — commands execute against the Base + Overlay
 * pair: the active region (base) and the active Scene (whose
 * overlay for that region holds the presences + Scene-scoped
 * assets). The session dispatch supplies both (Ambient Context
 * pattern — the author's current Scene selection decides which
 * Scene commands land in).
 */
export interface CommandExecutionContext {
  region: RegionDocument;
  scene: Scene;
}

export interface CommandExecutionResult {
  region: RegionDocument;
  scene: Scene;
  transaction: TransactionBoundary;
}

let txCounter = 0;

function nextTransactionId(): string {
  return `tx-${++txCounter}-${Date.now()}`;
}

function withOverlay(
  scene: Scene,
  regionId: string,
  mutate: (overlay: RegionSceneOverlay) => RegionSceneOverlay
): Scene {
  const current =
    scene.regionOverlays[regionId] ?? createRegionSceneOverlay();
  return {
    ...scene,
    regionOverlays: { ...scene.regionOverlays, [regionId]: mutate(current) }
  };
}

/**
 * Placed assets live in TWO stores post-058: the region's base
 * list and the active Scene's overlay list. Mutation commands
 * identify assets by instanceId, so by-id map/filter operations
 * apply to both stores — the store that doesn't contain the id
 * passes through unchanged. Only CREATE decides scope (mirrors
 * UE5 Data Layers: you pick an actor's layer at placement).
 */
function mapPlacedAssetsEverywhere(
  context: CommandExecutionContext,
  transform: (assets: PlacedAssetInstance[]) => PlacedAssetInstance[]
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const region = {
    ...context.region,
    placedAssets: transform(context.region.placedAssets)
  };
  const scene = context.scene.regionOverlays[regionId]
    ? withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        placedAssets: transform(overlay.placedAssets)
      }))
    : context.scene;
  return { region, scene };
}

/** Presences are overlay-only; these map the active Scene's
 *  presence lists for the context's region. */
function mapOverlayNpcPresences(
  context: CommandExecutionContext,
  transform: (presences: RegionNPCPresence[]) => RegionNPCPresence[]
): Scene {
  return withOverlay(
    context.scene,
    context.region.identity.id,
    (overlay) => ({ ...overlay, npcPresences: transform(overlay.npcPresences) })
  );
}

function mapOverlayItemPresences(
  context: CommandExecutionContext,
  transform: (presences: RegionItemPresence[]) => RegionItemPresence[]
): Scene {
  return withOverlay(
    context.scene,
    context.region.identity.id,
    (overlay) => ({
      ...overlay,
      itemPresences: transform(overlay.itemPresences)
    })
  );
}

/** Folder analog of `mapPlacedAssetsEverywhere` — folder trees
 *  exist on both the base and the overlay. */
function mapFoldersEverywhere(
  context: CommandExecutionContext,
  transform: (folders: RegionSceneFolder[]) => RegionSceneFolder[]
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const region = {
    ...context.region,
    folders: transform(context.region.folders)
  };
  const scene = context.scene.regionOverlays[regionId]
    ? withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        folders: transform(overlay.folders)
      }))
    : context.scene;
  return { region, scene };
}

function applyMovePlacedAsset(
  context: CommandExecutionContext,
  command: MovePlacedAssetCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
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
  );
}

function applyTransformPlacedAsset(
  context: CommandExecutionContext,
  command: TransformPlacedAssetCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
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
  );
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
  context: CommandExecutionContext,
  command: PlaceAssetInstanceCommand
): { region: RegionDocument; scene: Scene } {
  const created = createPlacedAssetFromCommand(command);
  const scope = command.payload.scope ?? "base";
  // Plan 058 §058.1 — scope decides which store the NEW asset
  // lands in. Omitted scope = base (preserves pre-058 behavior;
  // Studio starts passing overlay scope with 058.2's Scope
  // dropdown). An object scope always lands in the ACTIVE Scene
  // supplied by the dispatch context — a mismatched sceneId is a
  // dispatch bug, not something the executor can resolve.
  if (scope === "base") {
    return {
      region: {
        ...context.region,
        placedAssets: [...context.region.placedAssets, created]
      },
      scene: context.scene
    };
  }
  return {
    region: context.region,
    scene: withOverlay(
      context.scene,
      context.region.identity.id,
      (overlay) => ({
        ...overlay,
        placedAssets: [...overlay.placedAssets, created]
      })
    )
  };
}

function applyDuplicatePlacedAsset(
  context: CommandExecutionContext,
  command: DuplicatePlacedAssetCommand
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const overlayAssets =
    context.scene.regionOverlays[regionId]?.placedAssets ?? [];
  // Scope affinity: the duplicate lands in the same store as its
  // source (base copy stays base, overlay copy stays overlay).
  const baseSource = context.region.placedAssets.find(
    (asset) => asset.instanceId === command.payload.sourceInstanceId
  );
  const overlaySource = overlayAssets.find(
    (asset) => asset.instanceId === command.payload.sourceInstanceId
  );
  const source = baseSource ?? overlaySource;
  if (!source) {
    return { region: context.region, scene: context.scene };
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

  if (baseSource) {
    return {
      region: {
        ...context.region,
        placedAssets: [...context.region.placedAssets, duplicated]
      },
      scene: context.scene
    };
  }
  return {
    region: context.region,
    scene: withOverlay(context.scene, regionId, (overlay) => ({
      ...overlay,
      placedAssets: [...overlay.placedAssets, duplicated]
    }))
  };
}

function applyRemovePlacedAsset(
  context: CommandExecutionContext,
  command: RemovePlacedAssetCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.filter((asset) => asset.instanceId !== command.payload.instanceId)
  );
}

function applyBrushPlaceAssets(
  context: CommandExecutionContext,
  command: BrushPlaceAssetsCommand
): { region: RegionDocument; scene: Scene } {
  const folderSpec = command.payload.createFolder ?? null;
  const scope = command.payload.scope ?? "base";
  let workingContext = context;
  if (folderSpec) {
    const existsInBase = context.region.folders.some(
      (folder) => folder.folderId === folderSpec.folderId
    );
    const existsInOverlay = (
      context.scene.regionOverlays[context.region.identity.id]?.folders ?? []
    ).some((folder) => folder.folderId === folderSpec.folderId);
    if (!existsInBase && !existsInOverlay) {
      const folder = {
        folderId: folderSpec.folderId,
        displayName: folderSpec.displayName,
        parentFolderId: null
      };
      workingContext =
        scope === "base"
          ? {
              ...context,
              region: {
                ...context.region,
                folders: [...context.region.folders, folder]
              }
            }
          : {
              ...context,
              scene: withOverlay(
                context.scene,
                context.region.identity.id,
                (overlay) => ({
                  ...overlay,
                  folders: [...overlay.folders, folder]
                })
              )
            };
    }
  }
  const context2 = workingContext;
  const created: PlacedAssetInstance[] = command.payload.placements.map(
    (placement) => ({
      instanceId: placement.instanceId,
      assetDefinitionId: placement.assetDefinitionId,
      displayName: placement.displayName,
      parentFolderId: folderSpec?.folderId ?? command.payload.parentFolderId,
      inspectable: null,
      shaderOverrides: [],
      shaderParameterOverrides: [],
      brushed: true,
      transform: {
        position: placement.position,
        rotation: placement.rotation,
        scale: placement.scale
      }
    })
  );
  if (scope === "base") {
    return {
      region: {
        ...context2.region,
        placedAssets: [...context2.region.placedAssets, ...created]
      },
      scene: context2.scene
    };
  }
  return {
    region: context2.region,
    scene: withOverlay(
      context2.scene,
      context2.region.identity.id,
      (overlay) => ({
        ...overlay,
        placedAssets: [...overlay.placedAssets, ...created]
      })
    )
  };
}

function applyBrushEraseAssets(
  context: CommandExecutionContext,
  command: BrushEraseAssetsCommand
): { region: RegionDocument; scene: Scene } {
  const doomed = new Set(command.payload.instanceIds);
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.filter((asset) => !doomed.has(asset.instanceId))
  );
}

function applyMovePlacedAssetToFolder(
  context: CommandExecutionContext,
  command: MovePlacedAssetToFolderCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
      asset.instanceId === command.payload.instanceId
        ? {
            ...asset,
            parentFolderId: command.payload.parentFolderId
          }
        : asset
    )
  );
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
  context: CommandExecutionContext,
  command: AssignPlacedAssetInspectableCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
      asset.instanceId === command.payload.instanceId
        ? {
            ...asset,
            inspectable: createInspectableBehaviorFromCommand(command)
          }
        : asset
    )
  );
}

function applyUpdatePlacedAssetInspectable(
  context: CommandExecutionContext,
  command: UpdatePlacedAssetInspectableCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) => {
      if (
        asset.instanceId !== command.payload.instanceId ||
        !asset.inspectable
      ) {
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
  );
}

function applyRemovePlacedAssetInspectable(
  context: CommandExecutionContext,
  command: RemovePlacedAssetInspectableCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
      asset.instanceId === command.payload.instanceId
        ? {
            ...asset,
            inspectable: null
          }
        : asset
    )
  );
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
  context: CommandExecutionContext,
  command: CreatePlayerPresenceCommand
): Scene {
  const regionId = context.region.identity.id;
  // Plan 058 §058.1 — singularity is per (Scene, region): one
  // player spawn per region within each Scene. A different Scene
  // may place its own spawn in the same region.
  if (context.scene.regionOverlays[regionId]?.playerPresence) {
    return context.scene;
  }
  return withOverlay(context.scene, regionId, (overlay) => ({
    ...overlay,
    playerPresence: createPlayerPresenceFromCommand(command)
  }));
}

function applyTransformPlayerPresence(
  context: CommandExecutionContext,
  command: TransformPlayerPresenceCommand
): Scene {
  const regionId = context.region.identity.id;
  const existing = context.scene.regionOverlays[regionId]?.playerPresence;
  if (!existing || existing.presenceId !== command.payload.presenceId) {
    return context.scene;
  }
  return withOverlay(context.scene, regionId, (overlay) => ({
    ...overlay,
    playerPresence: {
      ...existing,
      transform: {
        position: command.payload.position,
        rotation: command.payload.rotation,
        scale: command.payload.scale
      }
    }
  }));
}

function applyRemovePlayerPresence(
  context: CommandExecutionContext,
  command: RemovePlayerPresenceCommand
): Scene {
  const regionId = context.region.identity.id;
  const existing = context.scene.regionOverlays[regionId]?.playerPresence;
  if (!existing || existing.presenceId !== command.payload.presenceId) {
    return context.scene;
  }
  return withOverlay(context.scene, regionId, (overlay) => ({
    ...overlay,
    playerPresence: null
  }));
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
  const next = overrides.filter(
    (override) => override.slot !== nextOverride.slot
  );
  next.push(nextOverride);
  return next;
}

function applySetPlacedAssetShaderOverride(
  context: CommandExecutionContext,
  command: SetPlacedAssetShaderOverrideCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
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
  );
}

function applySetPlacedAssetSurfaceSlotOverride(
  context: CommandExecutionContext,
  command: SetPlacedAssetSurfaceSlotOverrideCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) => {
      if (asset.instanceId !== command.payload.instanceId) {
        return asset;
      }
      const kept = (asset.surfaceSlotOverrides ?? []).filter(
        (slotOverride) => slotOverride.slotName !== command.payload.slotName
      );
      const next = command.payload.surface
        ? [
            ...kept,
            {
              slotName: command.payload.slotName,
              surface: command.payload.surface
            }
          ]
        : kept;
      return {
        ...asset,
        surfaceSlotOverrides: next.length > 0 ? next : undefined
      };
    })
  );
}

function applySetPlacedAssetShaderParameterOverride(
  context: CommandExecutionContext,
  command: SetPlacedAssetShaderParameterOverrideCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
      asset.instanceId === command.payload.instanceId
        ? {
            ...asset,
            shaderParameterOverrides: upsertShaderParameterOverride(
              asset.shaderParameterOverrides,
              {
                ...command.payload.override,
                slot: command.payload.override.slot ?? command.payload.slot
              }
            )
          }
        : asset
    )
  );
}

function applyClearPlacedAssetShaderParameterOverride(
  context: CommandExecutionContext,
  command: ClearPlacedAssetShaderParameterOverrideCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
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
  );
}

function applySetNPCPresenceShaderOverride(
  context: CommandExecutionContext,
  command: SetNPCPresenceShaderOverrideCommand
): Scene {
  return mapOverlayNpcPresences(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applySetNPCPresenceShaderParameterOverride(
  context: CommandExecutionContext,
  command: SetNPCPresenceShaderParameterOverrideCommand
): Scene {
  return mapOverlayNpcPresences(context, (presences) =>
    presences.map((presence) =>
      presence.presenceId === command.payload.presenceId
        ? {
            ...presence,
            shaderParameterOverrides: upsertShaderParameterOverride(
              presence.shaderParameterOverrides,
              {
                ...command.payload.override,
                slot: command.payload.override.slot ?? command.payload.slot
              }
            )
          }
        : presence
    )
  );
}

function applyClearNPCPresenceShaderParameterOverride(
  context: CommandExecutionContext,
  command: ClearNPCPresenceShaderParameterOverrideCommand
): Scene {
  return mapOverlayNpcPresences(context, (presences) =>
    presences.map((presence) =>
      presence.presenceId === command.payload.presenceId
        ? {
            ...presence,
            shaderParameterOverrides:
              presence.shaderParameterOverrides.filter(
                (override) =>
                  !(
                    override.parameterId === command.payload.parameterId &&
                    override.slot === command.payload.slot
                  )
              )
          }
        : presence
    )
  );
}

function applySetItemPresenceShaderOverride(
  context: CommandExecutionContext,
  command: SetItemPresenceShaderOverrideCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applySetItemPresenceShaderParameterOverride(
  context: CommandExecutionContext,
  command: SetItemPresenceShaderParameterOverrideCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) =>
    presences.map((presence) =>
      presence.presenceId === command.payload.presenceId
        ? {
            ...presence,
            shaderParameterOverrides: upsertShaderParameterOverride(
              presence.shaderParameterOverrides,
              {
                ...command.payload.override,
                slot: command.payload.override.slot ?? command.payload.slot
              }
            )
          }
        : presence
    )
  );
}

function applyClearItemPresenceShaderParameterOverride(
  context: CommandExecutionContext,
  command: ClearItemPresenceShaderParameterOverrideCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) =>
    presences.map((presence) =>
      presence.presenceId === command.payload.presenceId
        ? {
            ...presence,
            shaderParameterOverrides:
              presence.shaderParameterOverrides.filter(
                (override) =>
                  !(
                    override.parameterId === command.payload.parameterId &&
                    override.slot === command.payload.slot
                  )
              )
          }
        : presence
    )
  );
}

function applyCreateNPCPresence(
  context: CommandExecutionContext,
  command: CreateNPCPresenceCommand
): Scene {
  return mapOverlayNpcPresences(context, (presences) => [
    ...presences,
    createNPCPresenceFromCommand(command)
  ]);
}

function applyTransformNPCPresence(
  context: CommandExecutionContext,
  command: TransformNPCPresenceCommand
): Scene {
  return mapOverlayNpcPresences(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applyRemoveNPCPresence(
  context: CommandExecutionContext,
  command: RemoveNPCPresenceCommand
): Scene {
  return mapOverlayNpcPresences(context, (presences) =>
    presences.filter(
      (presence) => presence.presenceId !== command.payload.presenceId
    )
  );
}

function applyCreateItemPresence(
  context: CommandExecutionContext,
  command: CreateItemPresenceCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) => [
    ...presences,
    createItemPresenceFromCommand(command)
  ]);
}

function applyTransformItemPresence(
  context: CommandExecutionContext,
  command: TransformItemPresenceCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applyUpdateItemPresence(
  context: CommandExecutionContext,
  command: UpdateItemPresenceCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applyRemoveItemPresence(
  context: CommandExecutionContext,
  command: RemoveItemPresenceCommand
): Scene {
  return mapOverlayItemPresences(context, (presences) =>
    presences.filter(
      (presence) => presence.presenceId !== command.payload.presenceId
    )
  );
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
  context: CommandExecutionContext,
  command: CreateSceneFolderCommand
): { region: RegionDocument; scene: Scene } {
  const created = createFolderFromCommand(command);
  const scope = command.payload.scope ?? "base";
  if (scope === "base") {
    return {
      region: {
        ...context.region,
        folders: [...context.region.folders, created]
      },
      scene: context.scene
    };
  }
  return {
    region: context.region,
    scene: withOverlay(
      context.scene,
      context.region.identity.id,
      (overlay) => ({
        ...overlay,
        folders: [...overlay.folders, created]
      })
    )
  };
}

function applyRenameSceneFolder(
  context: CommandExecutionContext,
  command: RenameSceneFolderCommand
): { region: RegionDocument; scene: Scene } {
  return mapFoldersEverywhere(context, (folders) =>
    folders.map((folder) =>
      folder.folderId === command.payload.folderId
        ? {
            ...folder,
            displayName: command.payload.displayName
          }
        : folder
    )
  );
}

function applyDeleteSceneFolder(
  context: CommandExecutionContext,
  command: DeleteSceneFolderCommand
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const overlayFolders =
    context.scene.regionOverlays[regionId]?.folders ?? [];
  const folder =
    context.region.folders.find(
      (candidate) => candidate.folderId === command.payload.folderId
    ) ??
    overlayFolders.find(
      (candidate) => candidate.folderId === command.payload.folderId
    );
  if (!folder) {
    return { region: context.region, scene: context.scene };
  }

  // Reparent children (folders + assets) onto the deleted
  // folder's parent, in whichever store they live.
  const withReparentedFolders = mapFoldersEverywhere(
    context,
    (folders) =>
      folders
        .filter(
          (candidate) => candidate.folderId !== command.payload.folderId
        )
        .map((candidate) =>
          candidate.parentFolderId === command.payload.folderId
            ? {
                ...candidate,
                parentFolderId: folder.parentFolderId
              }
            : candidate
        )
  );
  return mapPlacedAssetsEverywhere(
    { region: withReparentedFolders.region, scene: withReparentedFolders.scene },
    (assets) =>
      assets.map((asset) =>
        asset.parentFolderId === command.payload.folderId
          ? {
              ...asset,
              parentFolderId: folder.parentFolderId
            }
          : asset
      )
  );
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
    ...(command.payload.slotName === undefined
      ? {}
      : { slotName: command.payload.slotName }),
    ...(command.payload.surface === undefined
      ? {}
      : { surface: command.payload.surface }),
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

function applyDeleteLandscapeChannel(
  region: RegionDocument,
  command: DeleteLandscapeChannelCommand
): RegionDocument {
  const nextSurfaceSlots = region.landscape.surfaceSlots.filter(
    (channel, channelIndex) =>
      channelIndex === 0 || channel.channelId !== command.payload.channelId
  );
  if (nextSurfaceSlots.length === region.landscape.surfaceSlots.length) {
    return region;
  }

  return {
    ...region,
    landscape: {
      ...region.landscape,
      surfaceSlots: nextSurfaceSlots
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

function applyUpdateRegionLayoutSketch(
  region: RegionDocument,
  command: UpdateRegionLayoutSketchCommand
): RegionDocument {
  // Deliberately leaves `region.landscape` reference untouched so
  // sketch commits skip the render mesh's re-apply path (Plan 065
  // §065.1 — the sketch is authoring ink, not surface data).
  return {
    ...region,
    layoutSketch: command.payload.layoutSketch
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

function applyCreateRegionSoundEmitter(
  region: RegionDocument,
  command: CreateRegionSoundEmitterCommand
): RegionDocument {
  return {
    ...region,
    audio: {
      ...region.audio,
      emitters: [...(region.audio?.emitters ?? []), command.payload.emitter],
      ambienceZones: region.audio?.ambienceZones ?? []
    }
  };
}

function applyUpdateRegionSoundEmitter(
  region: RegionDocument,
  command: UpdateRegionSoundEmitterCommand
): RegionDocument {
  return {
    ...region,
    audio: {
      ...region.audio,
      emitters: (region.audio?.emitters ?? []).map((emitter) =>
        emitter.emitterId === command.payload.emitterId
          ? { ...emitter, ...command.payload.patch }
          : emitter
      ),
      ambienceZones: region.audio?.ambienceZones ?? []
    }
  };
}

function applyDeleteRegionSoundEmitter(
  region: RegionDocument,
  command: DeleteRegionSoundEmitterCommand
): RegionDocument {
  return {
    ...region,
    audio: {
      ...region.audio,
      emitters: (region.audio?.emitters ?? []).filter(
        (emitter) => emitter.emitterId !== command.payload.emitterId
      ),
      ambienceZones: region.audio?.ambienceZones ?? []
    }
  };
}

function applyCreateRegionAmbienceZone(
  region: RegionDocument,
  command: CreateRegionAmbienceZoneCommand
): RegionDocument {
  return {
    ...region,
    audio: {
      ...region.audio,
      emitters: region.audio?.emitters ?? [],
      ambienceZones: [
        ...(region.audio?.ambienceZones ?? []),
        command.payload.zone
      ]
    }
  };
}

function applyUpdateRegionAmbienceZone(
  region: RegionDocument,
  command: UpdateRegionAmbienceZoneCommand
): RegionDocument {
  return {
    ...region,
    audio: {
      ...region.audio,
      emitters: region.audio?.emitters ?? [],
      ambienceZones: (region.audio?.ambienceZones ?? []).map((zone) =>
        zone.zoneId === command.payload.zoneId
          ? { ...zone, ...command.payload.patch }
          : zone
      )
    }
  };
}

function applyDeleteRegionAmbienceZone(
  region: RegionDocument,
  command: DeleteRegionAmbienceZoneCommand
): RegionDocument {
  return {
    ...region,
    audio: {
      ...region.audio,
      emitters: region.audio?.emitters ?? [],
      ambienceZones: (region.audio?.ambienceZones ?? []).filter(
        (zone) => zone.zoneId !== command.payload.zoneId
      )
    }
  };
}

export function executeCommand(
  context: CommandExecutionContext,
  command: SemanticCommand
): CommandExecutionResult {
  const { region, scene } = context;
  // Three apply families (Plan 058 §058.1):
  //   - Base+Overlay pairs (assets / folders — by-id across both
  //     stores; creates branch on payload.scope)
  //   - Scene-only (presences — always the active Scene's overlay)
  //   - Region-only (areas / landscape / audio / behaviors /
  //     metadata — untouched by the Scene split)
  let updatedRegion: RegionDocument = region;
  let updatedScene: Scene = scene;

  switch (command.kind) {
    case "MovePlacedAsset":
      ({ region: updatedRegion, scene: updatedScene } =
        applyMovePlacedAsset(context, command));
      break;
    case "TransformPlacedAsset":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformPlacedAsset(context, command));
      break;
    case "PlaceAssetInstance":
      ({ region: updatedRegion, scene: updatedScene } =
        applyPlaceAssetInstance(context, command));
      break;
    case "BrushPlaceAssets": {
      const result = applyBrushPlaceAssets(context, command);
      updatedRegion = result.region;
      updatedScene = result.scene;
      break;
    }
    case "BrushEraseAssets": {
      const result = applyBrushEraseAssets(context, command);
      updatedRegion = result.region;
      updatedScene = result.scene;
      break;
    }
    case "DuplicatePlacedAsset":
      ({ region: updatedRegion, scene: updatedScene } =
        applyDuplicatePlacedAsset(context, command));
      break;
    case "RemovePlacedAsset":
      ({ region: updatedRegion, scene: updatedScene } =
        applyRemovePlacedAsset(context, command));
      break;
    case "MovePlacedAssetToFolder":
      ({ region: updatedRegion, scene: updatedScene } =
        applyMovePlacedAssetToFolder(context, command));
      break;
    case "AssignPlacedAssetInspectable":
      ({ region: updatedRegion, scene: updatedScene } =
        applyAssignPlacedAssetInspectable(context, command));
      break;
    case "UpdatePlacedAssetInspectable":
      ({ region: updatedRegion, scene: updatedScene } =
        applyUpdatePlacedAssetInspectable(context, command));
      break;
    case "RemovePlacedAssetInspectable":
      ({ region: updatedRegion, scene: updatedScene } =
        applyRemovePlacedAssetInspectable(context, command));
      break;
    case "SetPlacedAssetShaderOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetPlacedAssetShaderOverride(context, command));
      break;
    case "SetPlacedAssetSurfaceSlotOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetPlacedAssetSurfaceSlotOverride(context, command));
      break;
    case "SetPlacedAssetShaderParameterOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetPlacedAssetShaderParameterOverride(context, command));
      break;
    case "ClearPlacedAssetShaderParameterOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applyClearPlacedAssetShaderParameterOverride(context, command));
      break;
    case "CreateSceneFolder":
      ({ region: updatedRegion, scene: updatedScene } =
        applyCreateSceneFolder(context, command));
      break;
    case "RenameSceneFolder":
      ({ region: updatedRegion, scene: updatedScene } =
        applyRenameSceneFolder(context, command));
      break;
    case "DeleteSceneFolder":
      ({ region: updatedRegion, scene: updatedScene } =
        applyDeleteSceneFolder(context, command));
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
    case "DeleteLandscapeChannel":
      updatedRegion = applyDeleteLandscapeChannel(region, command);
      break;
    case "PaintLandscape":
      updatedRegion = applyPaintLandscape(region, command);
      break;
    case "ConfigureLandscape":
      updatedRegion = applyConfigureLandscape(region, command);
      break;
    case "UpdateRegionLayoutSketch":
      updatedRegion = applyUpdateRegionLayoutSketch(region, command);
      break;
    case "CreateRegionSoundEmitter":
      updatedRegion = applyCreateRegionSoundEmitter(region, command);
      break;
    case "UpdateRegionSoundEmitter":
      updatedRegion = applyUpdateRegionSoundEmitter(region, command);
      break;
    case "DeleteRegionSoundEmitter":
      updatedRegion = applyDeleteRegionSoundEmitter(region, command);
      break;
    case "CreateRegionAmbienceZone":
      updatedRegion = applyCreateRegionAmbienceZone(region, command);
      break;
    case "UpdateRegionAmbienceZone":
      updatedRegion = applyUpdateRegionAmbienceZone(region, command);
      break;
    case "DeleteRegionAmbienceZone":
      updatedRegion = applyDeleteRegionAmbienceZone(region, command);
      break;
    case "CreatePlayerPresence":
      updatedScene = applyCreatePlayerPresence(context, command);
      break;
    case "TransformPlayerPresence":
      updatedScene = applyTransformPlayerPresence(context, command);
      break;
    case "RemovePlayerPresence":
      updatedScene = applyRemovePlayerPresence(context, command);
      break;
    case "CreateNPCPresence":
      updatedScene = applyCreateNPCPresence(context, command);
      break;
    case "TransformNPCPresence":
      updatedScene = applyTransformNPCPresence(context, command);
      break;
    case "SetNPCPresenceShaderOverride":
      updatedScene = applySetNPCPresenceShaderOverride(context, command);
      break;
    case "SetNPCPresenceShaderParameterOverride":
      updatedScene = applySetNPCPresenceShaderParameterOverride(
        context,
        command
      );
      break;
    case "ClearNPCPresenceShaderParameterOverride":
      updatedScene = applyClearNPCPresenceShaderParameterOverride(
        context,
        command
      );
      break;
    case "RemoveNPCPresence":
      updatedScene = applyRemoveNPCPresence(context, command);
      break;
    case "CreateItemPresence":
      updatedScene = applyCreateItemPresence(context, command);
      break;
    case "TransformItemPresence":
      updatedScene = applyTransformItemPresence(context, command);
      break;
    case "UpdateItemPresence":
      updatedScene = applyUpdateItemPresence(context, command);
      break;
    case "SetItemPresenceShaderOverride":
      updatedScene = applySetItemPresenceShaderOverride(context, command);
      break;
    case "SetItemPresenceShaderParameterOverride":
      updatedScene = applySetItemPresenceShaderParameterOverride(
        context,
        command
      );
      break;
    case "ClearItemPresenceShaderParameterOverride":
      updatedScene = applyClearItemPresenceShaderParameterOverride(
        context,
        command
      );
      break;
    case "RemoveItemPresence":
      updatedScene = applyRemoveItemPresence(context, command);
      break;
    default:
      throw new Error(`Unsupported command kind: ${command.kind}`);
  }

  const transaction: TransactionBoundary = {
    transactionId: nextTransactionId(),
    command,
    affectedAggregateIds:
      updatedScene === scene
        ? [region.identity.id]
        : [region.identity.id, scene.sceneId],
    committedAt: new Date().toISOString() as TimestampIso
  };

  return { region: updatedRegion, scene: updatedScene, transaction };
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
