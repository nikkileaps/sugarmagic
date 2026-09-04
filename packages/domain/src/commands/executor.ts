/**
 * Command executor: applies semantic commands to canonical documents.
 *
 * Intent → Command → Validation → Transaction → Canonical Mutation.
 * This is the single mutation boundary per ADR 004.
 */

import {
  createPlacedLight,
  placedLightSeedFromInstanceId,
  createRegionAreaDefinition,
  createRegionMarker,
  createRegionVolumeDefinition,
  resolveRegionVolumes,
  withDerivedRegionAliases,
  reconcileRegionVolumesFromAreas,
  createRegionNPCBehaviorDefinition,
  MAX_REGION_LANDSCAPE_CHANNELS
} from "../region-authoring";
import type {
  RegionDocument,
  PlacedAssetInstance,
  PlacedLight,
  RegionInspectableBehavior,
  RegionSceneFolder,
  RegionNPCPresence,
  RegionPlayerPresence,
  RegionItemPresence,
  RegionBehaviorQuestBinding
} from "../region-authoring";
import type { LandscapeSurfaceSlot } from "../surface";
import type { TransactionBoundary } from "../transactions";
import type { AuthoringHistory } from "../history";
import type { TimestampIso } from "../shared";
import type {
  SemanticCommand,
  MovePlacedAssetCommand,
  TransformPlacedAssetCommand,
  TransformPlacedLightCommand,
  TransformSceneObjectsCommand,
  PlaceAssetInstanceCommand,
  BrushPlaceAssetsCommand,
  BrushEraseAssetsCommand,
  DuplicatePlacedAssetCommand,
  RemovePlacedAssetCommand,
  PlaceLightCommand,
  UpdatePlacedLightCommand,
  RemovePlacedLightCommand,
  DuplicatePlacedLightCommand,
  MovePlacedAssetToFolderCommand,
  CreateSceneFolderCommand,
  RenameSceneFolderCommand,
  DeleteSceneFolderCommand,
  CreateRegionAreaCommand,
  UpdateRegionAreaCommand,
  DeleteRegionAreaCommand,
  CreateRegionMarkerCommand,
  UpdateRegionMarkerCommand,
  DeleteRegionMarkerCommand,
  CreateRegionVolumeCommand,
  UpdateRegionVolumeCommand,
  DeleteRegionVolumeCommand,
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
  CreatePlayerPresenceCommand,
  TransformPlayerPresenceCommand,
  RemovePlayerPresenceCommand,
  CreateNPCPresenceCommand,
  TransformNPCPresenceCommand,
  RemoveNPCPresenceCommand,
  SetNPCPresenceConditionCommand,
  SetNPCPresenceLabelCommand,
  CreateItemPresenceCommand,
  TransformItemPresenceCommand,
  UpdateItemPresenceCommand,
  RemoveItemPresenceCommand,
  AssignPlacedAssetInspectableCommand,
  UpdatePlacedAssetInspectableCommand,
  RemovePlacedAssetInspectableCommand,
  UpdateRegionMetadataCommand,
  SetRegionNavMeshCommand,
  SetPlacedAssetShaderOverrideCommand,
  SetPlacedAssetSurfaceSlotOverrideCommand,
  SetPlacedAssetColliderOverrideCommand,
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
  sceneDressesRegion,
  sceneOverlayForRegion,
  type RegionSceneOverlay,
  type Scene,
  type SceneAssetAppearanceOverride
} from "../scenes";
import { cloneAssetCollider } from "../content-library";

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

/**
 * Mutate the Scene's overlay. The Scene must be the one dressing this
 * region -- it happens in exactly one place, and writing its overlay
 * while the author edits somewhere else would put the edit in the wrong
 * region.
 *
 * Throws rather than passing the Scene through, because every caller here
 * either checks first (the by-id maps, where the store simply may not hold
 * the id) or is a CREATE whose entire effect is this write. Returning the
 * Scene unchanged made a create place nothing, report success, and leave
 * the author looking at a viewport that did not change.
 */
function withOverlay(
  scene: Scene,
  regionId: string,
  mutate: (overlay: RegionSceneOverlay) => RegionSceneOverlay
): Scene {
  if (!sceneDressesRegion(scene, regionId)) {
    throw new Error(
      `[commands] Scene ${scene.sceneId} happens in region ${scene.regionId}, ` +
        `so it cannot be edited while region ${regionId} is active. ` +
        `Dispatch against the Scene that dresses this region, or use the ` +
        `"base" scope to edit the region itself.`
    );
  }
  return { ...scene, overlay: mutate(scene.overlay) };
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
  const scene = sceneOverlayForRegion(context.scene, regionId)
    ? withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        placedAssets: transform(overlay.placedAssets)
      }))
    : context.scene;
  return { region, scene };
}

/** Placed lights live in the same two stores as placed assets, and are
 *  named by instanceId for the same reason. */
function mapPlacedLightsEverywhere(
  context: CommandExecutionContext,
  transform: (lights: PlacedLight[]) => PlacedLight[]
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const region = {
    ...context.region,
    placedLights: transform(context.region.placedLights)
  };
  const scene = sceneOverlayForRegion(context.scene, regionId)
    ? withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        placedLights: transform(overlay.placedLights)
      }))
    : context.scene;
  return { region, scene };
}

/**
 * Presences live in TWO stores (epic #226): the region's own residents
 * and the active Scene's overlay list — the same shape placed assets have
 * had since 058, and these map both for exactly the same reason.
 * Mutation commands identify a presence by presenceId, so a by-id
 * map/filter applies to both stores and the one without the id passes
 * through unchanged. Only CREATE decides which store it lands in.
 */
function mapNpcPresencesEverywhere(
  context: CommandExecutionContext,
  transform: (presences: RegionNPCPresence[]) => RegionNPCPresence[]
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const region = {
    ...context.region,
    npcPresences: transform(context.region.npcPresences)
  };
  const scene = sceneOverlayForRegion(context.scene, regionId)
    ? withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        npcPresences: transform(overlay.npcPresences)
      }))
    : context.scene;
  return { region, scene };
}

function mapItemPresencesEverywhere(
  context: CommandExecutionContext,
  transform: (presences: RegionItemPresence[]) => RegionItemPresence[]
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const region = {
    ...context.region,
    itemPresences: transform(context.region.itemPresences)
  };
  const scene = sceneOverlayForRegion(context.scene, regionId)
    ? withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        itemPresences: transform(overlay.itemPresences)
      }))
    : context.scene;
  return { region, scene };
}

/** Create targets the overlay: the Scene is what the author is editing
 *  when placing through this path. Build's region-scoped placement is
 *  its own story. */
function addOverlayNpcPresence(
  context: CommandExecutionContext,
  presence: RegionNPCPresence
): Scene {
  return withOverlay(context.scene, context.region.identity.id, (overlay) => ({
    ...overlay,
    npcPresences: [...overlay.npcPresences, presence]
  }));
}

function addOverlayItemPresence(
  context: CommandExecutionContext,
  presence: RegionItemPresence
): Scene {
  return withOverlay(context.scene, context.region.identity.id, (overlay) => ({
    ...overlay,
    itemPresences: [...overlay.itemPresences, presence]
  }));
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
  const scene = sceneOverlayForRegion(context.scene, regionId)
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

function applyTransformPlacedLight(
  context: CommandExecutionContext,
  command: TransformPlacedLightCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedLightsEverywhere(context, (lights) =>
    lights.map((light) =>
      light.instanceId === command.payload.instanceId
        ? {
            ...light,
            transform: {
              position: command.payload.position,
              rotation: command.payload.rotation,
              scale: command.payload.scale
            }
          }
        : light
    )
  );
}

/**
 * Move every object a gizmo drag covered.
 *
 * Each subject goes through the same function its own single-object transform
 * command uses, so a batch and a lone drag can never write an object
 * differently. Each step reads the result of the one before it, which is what
 * lets several subjects land in one region.
 */
function applyTransformSceneObjects(
  context: CommandExecutionContext,
  command: TransformSceneObjectsCommand
): { region: RegionDocument; scene: Scene } {
  return command.payload.subjects.reduce<CommandExecutionContext>(
    (current, subject) => {
      const { subjectId, position, rotation, scale } = subject;
      const target = command.target;
      switch (subject.subjectKind) {
        case "placed-asset":
          return applyTransformPlacedAsset(current, {
            kind: "TransformPlacedAsset",
            target,
            subject: { subjectKind: "placed-asset", subjectId },
            payload: { instanceId: subjectId, position, rotation, scale }
          });
        case "placed-light":
          return applyTransformPlacedLight(current, {
            kind: "TransformPlacedLight",
            target,
            subject: { subjectKind: "placed-light", subjectId },
            payload: { instanceId: subjectId, position, rotation, scale }
          });
        case "player-presence":
          return applyTransformPlayerPresence(current, {
            kind: "TransformPlayerPresence",
            target,
            subject: { subjectKind: "player-presence", subjectId },
            payload: { presenceId: subjectId, position, rotation, scale }
          });
        case "npc-presence":
          return applyTransformNPCPresence(current, {
            kind: "TransformNPCPresence",
            target,
            subject: { subjectKind: "npc-presence", subjectId },
            payload: { presenceId: subjectId, position, rotation, scale }
          });
        case "item-presence":
          return applyTransformItemPresence(current, {
            kind: "TransformItemPresence",
            target,
            subject: { subjectKind: "item-presence", subjectId },
            payload: { presenceId: subjectId, position, rotation, scale }
          });
        default: {
          const unhandled: never = subject.subjectKind;
          throw new Error(
            `[command-executor] TransformSceneObjects cannot move a ${unhandled}; give it a kind that commits through a transform command.`
          );
        }
      }
    },
    context
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
    sceneOverlayForRegion(context.scene, regionId)?.placedAssets ?? [];
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

function applyPlaceLight(
  context: CommandExecutionContext,
  command: PlaceLightCommand
): { region: RegionDocument; scene: Scene } {
  // Through the factory again, so a hand-built payload still lands with
  // its kind and its kind-specific fields agreeing.
  const created = createPlacedLight(command.payload.light);
  const scope = command.payload.scope ?? "base";
  if (scope === "base") {
    return {
      region: {
        ...context.region,
        placedLights: [...context.region.placedLights, created]
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
        placedLights: [...overlay.placedLights, created]
      })
    )
  };
}

function applyUpdatePlacedLight(
  context: CommandExecutionContext,
  command: UpdatePlacedLightCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedLightsEverywhere(context, (lights) =>
    lights.map((light) =>
      light.instanceId === command.payload.instanceId
        ? // The factory decides which fields survive, so changing the kind
          // drops the cone or the rectangle the old kind was carrying.
          createPlacedLight({ ...light, ...command.payload.patch })
        : light
    )
  );
}

function applyRemovePlacedLight(
  context: CommandExecutionContext,
  command: RemovePlacedLightCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlacedLightsEverywhere(context, (lights) =>
    lights.filter((light) => light.instanceId !== command.payload.instanceId)
  );
}

function applyDuplicatePlacedLight(
  context: CommandExecutionContext,
  command: DuplicatePlacedLightCommand
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const overlayLights =
    sceneOverlayForRegion(context.scene, regionId)?.placedLights ?? [];
  // Scope affinity: the copy lands in the same store as its source, the
  // way a duplicated placed asset does.
  const baseSource = context.region.placedLights.find(
    (light) => light.instanceId === command.payload.sourceInstanceId
  );
  const overlaySource = overlayLights.find(
    (light) => light.instanceId === command.payload.sourceInstanceId
  );
  const source = baseSource ?? overlaySource;
  if (!source) {
    // A selection can name a light that has already been deleted. There is
    // nothing to copy, and that is the outcome, not a failure.
    return { region: context.region, scene: context.scene };
  }

  const duplicated: PlacedLight = {
    ...source,
    instanceId: command.payload.duplicatedInstanceId,
    displayName: `${source.displayName} Copy`,
    modulation: {
      ...source.modulation,
      // A fresh seed off the new id: two copies of one candle that shared a
      // seed would flicker in lockstep.
      seed: placedLightSeedFromInstanceId(command.payload.duplicatedInstanceId)
    },
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
        placedLights: [...context.region.placedLights, duplicated]
      },
      scene: context.scene
    };
  }
  return {
    region: context.region,
    scene: withOverlay(context.scene, regionId, (overlay) => ({
      ...overlay,
      placedLights: [...overlay.placedLights, duplicated]
    }))
  };
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
      sceneOverlayForRegion(context.scene, context.region.identity.id)
        ?.folders ?? []
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
  // Singularity is per (Scene, region): one player spawn per region
  // within each Scene. A different Scene may place its own spawn in the
  // same region. A region's own start is not a conflict — the Scene's
  // answer simply wins over it when both exist (see
  // `composeRegionContents`), so this guard reads the overlay only.
  if (sceneOverlayForRegion(context.scene, regionId)?.playerPresence) {
    return context.scene;
  }
  return withOverlay(context.scene, regionId, (overlay) => ({
    ...overlay,
    playerPresence: createPlayerPresenceFromCommand(command)
  }));
}

/**
 * By-id like every other presence mutation: whichever store holds the id
 * is the one that changes. Reading the overlay alone made transform and
 * remove silent no-ops on a region's own player start.
 *
 * The list funnels above take a list transform; a player start is singular,
 * so this one takes the presence itself and returns its replacement, or
 * null to clear it. Both callers route through here so "which store owns
 * this id" is answered in exactly one place.
 */
function mapPlayerPresenceEverywhere(
  context: CommandExecutionContext,
  presenceId: string,
  transform: (presence: RegionPlayerPresence) => RegionPlayerPresence | null
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const inOverlay = sceneOverlayForRegion(
    context.scene,
    regionId
  )?.playerPresence;
  if (inOverlay?.presenceId === presenceId) {
    return {
      region: context.region,
      scene: withOverlay(context.scene, regionId, (overlay) => ({
        ...overlay,
        playerPresence: transform(inOverlay)
      }))
    };
  }
  const inRegion = context.region.playerPresence;
  if (inRegion?.presenceId === presenceId) {
    return {
      region: { ...context.region, playerPresence: transform(inRegion) },
      scene: context.scene
    };
  }
  // An id in neither store is a no-op, the same answer the by-id list
  // funnels give when nothing matches.
  return { region: context.region, scene: context.scene };
}

function applyTransformPlayerPresence(
  context: CommandExecutionContext,
  command: TransformPlayerPresenceCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlayerPresenceEverywhere(
    context,
    command.payload.presenceId,
    (presence) => ({
      ...presence,
      transform: {
        position: command.payload.position,
        rotation: command.payload.rotation,
        scale: command.payload.scale
      }
    })
  );
}

function applyRemovePlayerPresence(
  context: CommandExecutionContext,
  command: RemovePlayerPresenceCommand
): { region: RegionDocument; scene: Scene } {
  return mapPlayerPresenceEverywhere(
    context,
    command.payload.presenceId,
    () => null
  );
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
    },
    condition: null,
    placementLabel: null
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

/**
 * Scene-scope appearance routing (Plan 068.2). A "scene" write on a
 * BASE placement lands in the active Scene's
 * `assetAppearanceOverrides` record. A "scene" write on an instance
 * that LIVES in the Scene overlay routes to the instance itself --
 * containment already scene-scopes its fields, and double-recording
 * would create two competing sources of truth for one look.
 */
function isSceneContainedInstance(
  context: CommandExecutionContext,
  instanceId: string
): boolean {
  const overlay = sceneOverlayForRegion(
    context.scene,
    context.region.identity.id
  );
  return Boolean(
    overlay?.placedAssets.some((asset) => asset.instanceId === instanceId)
  );
}

function mutateSceneAppearanceOverride(
  context: CommandExecutionContext,
  instanceId: string,
  mutate: (
    current: SceneAssetAppearanceOverride
  ) => SceneAssetAppearanceOverride
): { region: RegionDocument; scene: Scene } {
  const regionId = context.region.identity.id;
  const scene = withOverlay(context.scene, regionId, (overlay) => {
    const current = overlay.assetAppearanceOverrides[instanceId] ?? {};
    const next = mutate(current);
    const isEmpty =
      (next.surfaceSlotOverrides?.length ?? 0) === 0 &&
      (next.shaderOverrides?.length ?? 0) === 0 &&
      !next.colliderOverride;
    const assetAppearanceOverrides = { ...overlay.assetAppearanceOverrides };
    if (isEmpty) {
      delete assetAppearanceOverrides[instanceId];
    } else {
      assetAppearanceOverrides[instanceId] = next;
    }
    return { ...overlay, assetAppearanceOverrides };
  });
  return { region: context.region, scene };
}

function applySetPlacedAssetShaderOverride(
  context: CommandExecutionContext,
  command: SetPlacedAssetShaderOverrideCommand
): { region: RegionDocument; scene: Scene } {
  if (
    command.payload.scope === "scene" &&
    !isSceneContainedInstance(context, command.payload.instanceId)
  ) {
    return mutateSceneAppearanceOverride(
      context,
      command.payload.instanceId,
      (current) => ({
        ...current,
        shaderOverrides: command.payload.shaderDefinitionId
          ? upsertShaderBindingOverride(current.shaderOverrides ?? [], {
              shaderDefinitionId: command.payload.shaderDefinitionId,
              slot: command.payload.slot
            })
          : (current.shaderOverrides ?? []).filter(
              (override) => override.slot !== command.payload.slot
            )
      })
    );
  }
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
  if (
    command.payload.scope === "scene" &&
    !isSceneContainedInstance(context, command.payload.instanceId)
  ) {
    return mutateSceneAppearanceOverride(
      context,
      command.payload.instanceId,
      (current) => {
        const kept = (current.surfaceSlotOverrides ?? []).filter(
          (slotOverride) => slotOverride.slotName !== command.payload.slotName
        );
        return {
          ...current,
          surfaceSlotOverrides: command.payload.surface
            ? [
                ...kept,
                {
                  slotName: command.payload.slotName,
                  surface: command.payload.surface
                }
              ]
            : kept
        };
      }
    );
  }
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

function applySetPlacedAssetColliderOverride(
  context: CommandExecutionContext,
  command: SetPlacedAssetColliderOverrideCommand
): { region: RegionDocument; scene: Scene } {
  const { instanceId, collider } = command.payload;
  // Scene-scope write on a base instance -> the Scene overlay's restyle bag.
  if (
    command.payload.scope === "scene" &&
    !isSceneContainedInstance(context, instanceId)
  ) {
    return mutateSceneAppearanceOverride(context, instanceId, (current) => ({
      ...current,
      colliderOverride: collider ? cloneAssetCollider(collider) : undefined
    }));
  }
  // Base scope (or a scene-contained instance): the instance's own field.
  return mapPlacedAssetsEverywhere(context, (assets) =>
    assets.map((asset) =>
      asset.instanceId === instanceId
        ? {
            ...asset,
            colliderOverride: collider
              ? cloneAssetCollider(collider)
              : undefined
          }
        : asset
    )
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
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
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
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
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
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applySetItemPresenceShaderOverride(
  context: CommandExecutionContext,
  command: SetItemPresenceShaderOverrideCommand
): { region: RegionDocument; scene: Scene } {
  return mapItemPresencesEverywhere(context, (presences) =>
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
): { region: RegionDocument; scene: Scene } {
  return mapItemPresencesEverywhere(context, (presences) =>
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
): { region: RegionDocument; scene: Scene } {
  return mapItemPresencesEverywhere(context, (presences) =>
    presences.map((presence) =>
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
  );
}

function applyCreateNPCPresence(
  context: CommandExecutionContext,
  command: CreateNPCPresenceCommand
): Scene {
  return addOverlayNpcPresence(context, createNPCPresenceFromCommand(command));
}

function applyTransformNPCPresence(
  context: CommandExecutionContext,
  command: TransformNPCPresenceCommand
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
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

function applySetNPCPresenceCondition(
  context: CommandExecutionContext,
  command: SetNPCPresenceConditionCommand
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
    presences.map((presence) =>
      presence.presenceId === command.payload.presenceId
        ? { ...presence, condition: command.payload.condition }
        : presence
    )
  );
}

function applySetNPCPresenceLabel(
  context: CommandExecutionContext,
  command: SetNPCPresenceLabelCommand
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
    presences.map((presence) =>
      presence.presenceId === command.payload.presenceId
        ? { ...presence, placementLabel: command.payload.label }
        : presence
    )
  );
}

function applyRemoveNPCPresence(
  context: CommandExecutionContext,
  command: RemoveNPCPresenceCommand
): { region: RegionDocument; scene: Scene } {
  return mapNpcPresencesEverywhere(context, (presences) =>
    presences.filter(
      (presence) => presence.presenceId !== command.payload.presenceId
    )
  );
}

function applyCreateItemPresence(
  context: CommandExecutionContext,
  command: CreateItemPresenceCommand
): Scene {
  return addOverlayItemPresence(
    context,
    createItemPresenceFromCommand(command)
  );
}

function applyTransformItemPresence(
  context: CommandExecutionContext,
  command: TransformItemPresenceCommand
): { region: RegionDocument; scene: Scene } {
  return mapItemPresencesEverywhere(context, (presences) =>
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
): { region: RegionDocument; scene: Scene } {
  return mapItemPresencesEverywhere(context, (presences) =>
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
): { region: RegionDocument; scene: Scene } {
  return mapItemPresencesEverywhere(context, (presences) =>
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
    sceneOverlayForRegion(context.scene, regionId)?.folders ?? [];
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
  const withReparentedFolders = mapFoldersEverywhere(context, (folders) =>
    folders
      .filter((candidate) => candidate.folderId !== command.payload.folderId)
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
    {
      region: withReparentedFolders.region,
      scene: withReparentedFolders.scene
    },
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
  // Plan 069.4 — compute the intended area list, then reconcile it into the
  // canonical `volumes` (which re-derives the area/ambience aliases).
  const nextAreas = [
    ...region.areas,
    createRegionAreaDefinition({
      areaId: command.payload.areaId,
      displayName: command.payload.displayName,
      lorePageId: command.payload.lorePageId,
      parentAreaId: command.payload.parentAreaId,
      kind: command.payload.kind,
      bounds: command.payload.bounds
    })
  ];
  return reconcileRegionVolumesFromAreas(region, nextAreas);
}

function applyUpdateRegionArea(
  region: RegionDocument,
  command: UpdateRegionAreaCommand
): RegionDocument {
  const nextAreas = region.areas.map((area) =>
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
  );
  return reconcileRegionVolumesFromAreas(region, nextAreas);
}

function applyDeleteRegionArea(
  region: RegionDocument,
  command: DeleteRegionAreaCommand
): RegionDocument {
  const deletedAreaId = command.payload.areaId;
  const nextAreas = region.areas
    .filter((area) => area.areaId !== deletedAreaId)
    .map((area) =>
      area.parentAreaId === deletedAreaId
        ? { ...area, parentAreaId: null }
        : area
    );
  return reconcileRegionVolumesFromAreas(region, nextAreas);
}

// Plan 069.7 — direct Volume authoring. Operate on the canonical volumes
// and re-derive the `@deprecated` area/ambience aliases (commands don't
// re-normalize).
function applyCreateRegionMarker(
  region: RegionDocument,
  command: CreateRegionMarkerCommand
): RegionDocument {
  return {
    ...region,
    markers: [
      ...(region.markers ?? []),
      createRegionMarker(command.payload.marker)
    ]
  };
}

function applyUpdateRegionMarker(
  region: RegionDocument,
  command: UpdateRegionMarkerCommand
): RegionDocument {
  return {
    ...region,
    markers: (region.markers ?? []).map((marker) =>
      marker.markerId === command.payload.markerId
        ? createRegionMarker({ ...marker, ...command.payload.patch })
        : marker
    )
  };
}

function applyDeleteRegionMarker(
  region: RegionDocument,
  command: DeleteRegionMarkerCommand
): RegionDocument {
  return {
    ...region,
    markers: (region.markers ?? []).filter(
      (marker) => marker.markerId !== command.payload.markerId
    )
  };
}

function applyCreateRegionVolume(
  region: RegionDocument,
  command: CreateRegionVolumeCommand
): RegionDocument {
  const volumes = [
    ...resolveRegionVolumes(region),
    createRegionVolumeDefinition(command.payload.volume)
  ];
  return withDerivedRegionAliases(region, volumes);
}

function applyUpdateRegionVolume(
  region: RegionDocument,
  command: UpdateRegionVolumeCommand
): RegionDocument {
  const volumes = resolveRegionVolumes(region).map((volume) =>
    volume.volumeId !== command.payload.volumeId
      ? volume
      : createRegionVolumeDefinition({
          ...volume,
          ...command.payload.patch,
          volumeId: volume.volumeId
        })
  );
  return withDerivedRegionAliases(region, volumes);
}

function applyDeleteRegionVolume(
  region: RegionDocument,
  command: DeleteRegionVolumeCommand
): RegionDocument {
  const deletedId = command.payload.volumeId;
  const volumes = resolveRegionVolumes(region)
    .filter((volume) => volume.volumeId !== deletedId)
    .map((volume) =>
      volume.parentVolumeId === deletedId
        ? { ...volume, parentVolumeId: null }
        : volume
    );
  return withDerivedRegionAliases(region, volumes);
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
      emitters: [...(region.audio?.emitters ?? []), command.payload.emitter]
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
      )
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
      )
    }
  };
}

export function executeCommand(
  context: CommandExecutionContext,
  command: SemanticCommand
): CommandExecutionResult {
  const { region, scene } = context;
  // Two apply families:
  //   - Region+Overlay pairs (assets, folders, and presences — by-id
  //     across both stores; creates decide which store they land in)
  //   - Region-only (areas / landscape / audio / behaviors /
  //     metadata — no overlay counterpart exists)
  let updatedRegion: RegionDocument = region;
  let updatedScene: Scene = scene;

  switch (command.kind) {
    case "MovePlacedAsset":
      ({ region: updatedRegion, scene: updatedScene } = applyMovePlacedAsset(
        context,
        command
      ));
      break;
    case "TransformPlacedAsset":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformPlacedAsset(context, command));
      break;
    case "TransformPlacedLight":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformPlacedLight(context, command));
      break;
    case "TransformSceneObjects":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformSceneObjects(context, command));
      break;
    case "PlaceAssetInstance":
      ({ region: updatedRegion, scene: updatedScene } = applyPlaceAssetInstance(
        context,
        command
      ));
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
      ({ region: updatedRegion, scene: updatedScene } = applyRemovePlacedAsset(
        context,
        command
      ));
      break;
    case "PlaceLight":
      ({ region: updatedRegion, scene: updatedScene } = applyPlaceLight(
        context,
        command
      ));
      break;
    case "UpdatePlacedLight":
      ({ region: updatedRegion, scene: updatedScene } = applyUpdatePlacedLight(
        context,
        command
      ));
      break;
    case "RemovePlacedLight":
      ({ region: updatedRegion, scene: updatedScene } = applyRemovePlacedLight(
        context,
        command
      ));
      break;
    case "DuplicatePlacedLight":
      ({ region: updatedRegion, scene: updatedScene } =
        applyDuplicatePlacedLight(context, command));
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
    case "SetPlacedAssetColliderOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetPlacedAssetColliderOverride(context, command));
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
      ({ region: updatedRegion, scene: updatedScene } = applyCreateSceneFolder(
        context,
        command
      ));
      break;
    case "RenameSceneFolder":
      ({ region: updatedRegion, scene: updatedScene } = applyRenameSceneFolder(
        context,
        command
      ));
      break;
    case "DeleteSceneFolder":
      ({ region: updatedRegion, scene: updatedScene } = applyDeleteSceneFolder(
        context,
        command
      ));
      break;
    case "UpdateRegionMetadata":
      updatedRegion = applyUpdateRegionMetadata(region, command);
      break;
    case "SetRegionNavMesh":
      updatedRegion = { ...region, navMesh: command.payload.navMesh };
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
    case "CreateRegionMarker":
      updatedRegion = applyCreateRegionMarker(region, command);
      break;
    case "UpdateRegionMarker":
      updatedRegion = applyUpdateRegionMarker(region, command);
      break;
    case "DeleteRegionMarker":
      updatedRegion = applyDeleteRegionMarker(region, command);
      break;
    case "CreateRegionVolume":
      updatedRegion = applyCreateRegionVolume(region, command);
      break;
    case "UpdateRegionVolume":
      updatedRegion = applyUpdateRegionVolume(region, command);
      break;
    case "DeleteRegionVolume":
      updatedRegion = applyDeleteRegionVolume(region, command);
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
    case "CreatePlayerPresence":
      updatedScene = applyCreatePlayerPresence(context, command);
      break;
    case "TransformPlayerPresence":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformPlayerPresence(context, command));
      break;
    case "RemovePlayerPresence":
      ({ region: updatedRegion, scene: updatedScene } =
        applyRemovePlayerPresence(context, command));
      break;
    case "CreateNPCPresence":
      updatedScene = applyCreateNPCPresence(context, command);
      break;
    case "TransformNPCPresence":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformNPCPresence(context, command));
      break;
    case "SetNPCPresenceShaderOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetNPCPresenceShaderOverride(context, command));
      break;
    case "SetNPCPresenceShaderParameterOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetNPCPresenceShaderParameterOverride(context, command));
      break;
    case "ClearNPCPresenceShaderParameterOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applyClearNPCPresenceShaderParameterOverride(context, command));
      break;
    case "SetNPCPresenceCondition":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetNPCPresenceCondition(context, command));
      break;
    case "SetNPCPresenceLabel":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetNPCPresenceLabel(context, command));
      break;
    case "RemoveNPCPresence":
      ({ region: updatedRegion, scene: updatedScene } = applyRemoveNPCPresence(
        context,
        command
      ));
      break;
    case "CreateItemPresence":
      updatedScene = applyCreateItemPresence(context, command);
      break;
    case "TransformItemPresence":
      ({ region: updatedRegion, scene: updatedScene } =
        applyTransformItemPresence(context, command));
      break;
    case "UpdateItemPresence":
      ({ region: updatedRegion, scene: updatedScene } = applyUpdateItemPresence(
        context,
        command
      ));
      break;
    case "SetItemPresenceShaderOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetItemPresenceShaderOverride(context, command));
      break;
    case "SetItemPresenceShaderParameterOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applySetItemPresenceShaderParameterOverride(context, command));
      break;
    case "ClearItemPresenceShaderParameterOverride":
      ({ region: updatedRegion, scene: updatedScene } =
        applyClearItemPresenceShaderParameterOverride(context, command));
      break;
    case "RemoveItemPresence":
      ({ region: updatedRegion, scene: updatedScene } = applyRemoveItemPresence(
        context,
        command
      ));
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
