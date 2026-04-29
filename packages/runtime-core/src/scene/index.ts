import {
  getAssetDefinition,
  getCharacterModelDefinition,
  type AssetKind,
  type ContentLibrarySnapshot,
  type ItemDefinition,
  type NPCDefinition,
  type PlayerDefinition,
  type RegionDocument,
  type RegionItemPresence,
  type PlacedAssetInstance,
  type RegionNPCPresence,
  type RegionPlayerPresence
} from "@sugarmagic/domain";
import type {
  EffectiveMaterialSlotBinding,
  ResolvedSurfaceStack,
  EffectiveShaderBinding
} from "../shader";
import {
  type EffectiveShaderBindingSet,
  resolveEffectiveAssetMaterialSlotBindings,
  resolveEffectiveAssetShaderBindings,
  resolveEffectivePresenceMaterialSlotBindings,
  resolveEffectivePresenceShaderBindings
} from "../shader";

/**
 * Platform-agnostic scene loading semantics.
 *
 * runtime-core owns the logic of resolving canonical authored documents into
 * scene descriptions. Platform hosts consume this description to produce
 * renderer-specific objects.
 */

const PLAYER_CAPSULE_COLOR = 0x89b4fa;
const NPC_CAPSULE_COLOR = 0xa6e3a1;

export interface RuntimeSceneLoadRequest {
  region: RegionDocument;
  compileProfile: "authoring-preview" | "runtime-preview" | "published-target";
}

export interface RuntimeSceneDescriptor {
  sceneId: string;
  regionId: string;
}

export interface SceneObjectTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SceneObjectCapsuleSpec {
  height: number;
  radius: number;
  color: number;
}

export type SceneObjectKind = "asset" | "player" | "npc" | "item";

export interface SceneObject {
  instanceId: string;
  kind: SceneObjectKind;
  displayName: string;
  assetDefinitionId: string | null;
  assetKind: AssetKind | null;
  modelSourcePath: string | null;
  targetModelHeight: number | null;
  effectiveShaders: EffectiveShaderBindingSet;
  effectiveMaterialSlots: EffectiveMaterialSlotBinding[];
  /**
   * @deprecated Legacy singular shader view retained as a shim while hosts and
   * tests move to effectiveShaders.
   */
  effectiveShader?: EffectiveShaderBinding | null;
  transform: SceneObjectTransform;
  representationKey: string;
  capsule: SceneObjectCapsuleSpec | null;
}

export interface SceneDelta {
  added: SceneObject[];
  updated: SceneObject[];
  removed: string[];
}

export interface SceneResolutionOptions {
  contentLibrary?: ContentLibrarySnapshot;
  playerDefinition?: PlayerDefinition | null;
  itemDefinitions?: ItemDefinition[];
  npcDefinitions?: NPCDefinition[];
  includePlayerPresence?: boolean;
}

export function resolveSceneObjects(
  region: RegionDocument,
  options: SceneResolutionOptions = {}
): SceneObject[] {
  const {
    contentLibrary,
    playerDefinition = null,
    itemDefinitions = [],
    npcDefinitions = [],
    includePlayerPresence = true
  } = options;

  const sceneObjects = region.scene.placedAssets.map((asset) =>
    createPlacedAssetSceneObject(asset, contentLibrary)
  );

  if (includePlayerPresence && region.scene.playerPresence) {
    sceneObjects.push(
      createPlayerSceneObject(region.scene.playerPresence, playerDefinition, contentLibrary)
    );
  }

  for (const presence of region.scene.npcPresences) {
    sceneObjects.push(
      createNPCSceneObject(
        presence,
        npcDefinitions.find(
          (definition) => definition.definitionId === presence.npcDefinitionId
        ) ?? null,
        contentLibrary
      )
    );
  }

  for (const presence of region.scene.itemPresences) {
    sceneObjects.push(
      createItemSceneObject(
        presence,
        itemDefinitions.find(
          (definition) => definition.definitionId === presence.itemDefinitionId
        ) ?? null,
        contentLibrary
      )
    );
  }

  return sceneObjects;
}

export function computeSceneDelta(
  previous: SceneObject[],
  current: SceneObject[]
): SceneDelta {
  const prevMap = new Map(previous.map((o) => [o.instanceId, o]));
  const currMap = new Map(current.map((o) => [o.instanceId, o]));

  const added: SceneObject[] = [];
  const updated: SceneObject[] = [];
  const removed: string[] = [];

  for (const [id, obj] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      added.push(obj);
    } else if (
      prev.kind !== obj.kind ||
      prev.displayName !== obj.displayName ||
      prev.representationKey !== obj.representationKey ||
      prev.transform.position[0] !== obj.transform.position[0] ||
      prev.transform.position[1] !== obj.transform.position[1] ||
      prev.transform.position[2] !== obj.transform.position[2] ||
      prev.transform.rotation[0] !== obj.transform.rotation[0] ||
      prev.transform.rotation[1] !== obj.transform.rotation[1] ||
      prev.transform.rotation[2] !== obj.transform.rotation[2] ||
      prev.transform.scale[0] !== obj.transform.scale[0] ||
      prev.transform.scale[1] !== obj.transform.scale[1] ||
      prev.transform.scale[2] !== obj.transform.scale[2]
    ) {
      updated.push(obj);
    }
  }

  for (const id of prevMap.keys()) {
    if (!currMap.has(id)) {
      removed.push(id);
    }
  }

  return { added, updated, removed };
}

function shaderRepresentationKey(
  effectiveShaders: EffectiveShaderBindingSet,
  effectiveMaterialSlots: EffectiveMaterialSlotBinding[],
  _parameterOverrides: { parameterId: string; value: unknown; slot?: "surface" | "deform" | "effect" }[]
): string {
  return [
    shaderSlotRepresentation("surface", effectiveShaders.surface),
    shaderSlotRepresentation("deform", effectiveShaders.deform),
    shaderSlotRepresentation("effect", effectiveShaders.effect),
    ...effectiveMaterialSlots.map((slot) =>
      `material:${slot.slotIndex}:${slot.slotName}:${slot.materialDefinitionId ?? "none"}:${surfaceStackRepresentation(slot.surface)}`
    )
  ].join(":");
}

function shaderSlotRepresentation(
  slotLabel: string,
  binding: EffectiveShaderBinding | null
): string {
  if (!binding) {
    return `${slotLabel}:none`;
  }
  const serializedParams = Object.keys(binding.parameterValues)
    .sort()
    .map((key) => `${key}=${JSON.stringify(binding.parameterValues[key])}`)
    .join("|");
  return `${slotLabel}:${binding.shaderDefinitionId}[${serializedParams}]`;
}

function surfaceStackRepresentation(
  binding: ResolvedSurfaceStack | null
): string {
  if (!binding) {
    return "surface:none";
  }
  return binding.layers
    .map((layer) => {
      if (layer.kind === "scatter") {
        return `${layer.kind}:${layer.contentKind}:${layer.definitionId}`;
      }
      const serializedParams = Object.keys(layer.binding.parameterValues)
        .sort()
        .map((key) => `${key}=${JSON.stringify(layer.binding.parameterValues[key])}`)
        .join("|");
      return `${layer.kind}:${layer.binding.shaderDefinitionId}[${serializedParams}]`;
    })
    .join(";");
}

function createPlacedAssetSceneObject(
  asset: PlacedAssetInstance,
  contentLibrary?: ContentLibrarySnapshot
): SceneObject {
  const assetDescriptor = getAssetSourceDescriptor(
    asset.assetDefinitionId,
    contentLibrary
  );
  const effectiveShaders = contentLibrary
    ? resolveEffectiveAssetShaderBindings(asset, contentLibrary)
    : { surface: null, deform: null, effect: null };
  const effectiveMaterialSlots = contentLibrary
    ? resolveEffectiveAssetMaterialSlotBindings(asset, contentLibrary)
    : [];

  return {
    instanceId: asset.instanceId,
    kind: "asset",
    displayName: asset.displayName,
    assetDefinitionId: asset.assetDefinitionId,
    assetKind: assetDescriptor.assetKind,
    modelSourcePath: assetDescriptor.sourcePath,
    targetModelHeight: null,
    effectiveShaders,
    effectiveMaterialSlots,
    effectiveShader: effectiveShaders.surface ?? effectiveShaders.deform ?? effectiveShaders.effect,
    transform: {
      position: asset.transform.position,
      rotation: asset.transform.rotation,
      scale: asset.transform.scale
    },
    representationKey: `asset:${asset.assetDefinitionId}:${assetDescriptor.assetKind ?? "unknown"}:${assetDescriptor.sourcePath ?? "fallback"}:${shaderRepresentationKey(effectiveShaders, effectiveMaterialSlots, asset.shaderParameterOverrides)}`,
    capsule: null
  };
}

function createPlayerSceneObject(
  presence: RegionPlayerPresence,
  playerDefinition: PlayerDefinition | null,
  contentLibrary?: ContentLibrarySnapshot
): SceneObject {
  const modelAssetDefinitionId = playerDefinition?.presentation.modelAssetDefinitionId ?? null;
  // Player models live in the entity-owned characterModelDefinitions
  // collection post-Plan-038, NOT in the general assetDefinitions.
  const assetDescriptor = getCharacterModelSourceDescriptor(
    modelAssetDefinitionId,
    contentLibrary
  );
  const height = Math.max(playerDefinition?.physicalProfile.height ?? 1.8, 0.5);
  const radius = Math.max(
    playerDefinition?.physicalProfile.radius ?? 0.35,
    Math.min(0.45, height * 0.45)
  );

  return {
    instanceId: presence.presenceId,
    kind: "player",
    displayName: playerDefinition?.displayName ?? "Player",
    assetDefinitionId: modelAssetDefinitionId,
    assetKind: assetDescriptor.assetKind,
    modelSourcePath: assetDescriptor.sourcePath,
    targetModelHeight: height,
    effectiveShaders: { surface: null, deform: null, effect: null },
    effectiveMaterialSlots: contentLibrary && assetDescriptor.definition
      ? resolveEffectivePresenceMaterialSlotBindings(
          { shaderOverrides: [], shaderParameterOverrides: [] },
          assetDescriptor.definition,
          contentLibrary
        )
      : [],
    effectiveShader: null,
    transform: {
      position: presence.transform.position,
      rotation: presence.transform.rotation,
      scale: presence.transform.scale
    },
    representationKey: `player:${modelAssetDefinitionId ?? "capsule"}:${assetDescriptor.assetKind ?? "unknown"}:${assetDescriptor.sourcePath ?? "fallback"}:${height}:${radius}:${shaderRepresentationKey(
      { surface: null, deform: null, effect: null },
      contentLibrary && assetDescriptor.definition
        ? resolveEffectivePresenceMaterialSlotBindings(
            { shaderOverrides: [], shaderParameterOverrides: [] },
            assetDescriptor.definition,
            contentLibrary
          )
        : [],
      []
    )}`,
    capsule: {
      height,
      radius,
      color: PLAYER_CAPSULE_COLOR
    }
  };
}

function createNPCSceneObject(
  presence: RegionNPCPresence,
  npcDefinition: NPCDefinition | null,
  contentLibrary?: ContentLibrarySnapshot
): SceneObject {
  const modelAssetDefinitionId = npcDefinition?.presentation.modelAssetDefinitionId ?? null;
  // NPC models live in the entity-owned characterModelDefinitions
  // collection post-Plan-038, NOT in the general assetDefinitions.
  const assetDescriptor = getCharacterModelSourceDescriptor(
    modelAssetDefinitionId,
    contentLibrary
  );
  const height = Math.max(npcDefinition?.presentation.modelHeight ?? 1.7, 0.5);
  const radius = Math.max(0.25, Math.min(0.45, height * 0.22));
  const effectiveShaders = contentLibrary
    ? resolveEffectivePresenceShaderBindings(presence, assetDescriptor.definition, contentLibrary)
    : { surface: null, deform: null, effect: null };
  const effectiveMaterialSlots = contentLibrary
    ? resolveEffectivePresenceMaterialSlotBindings(
        presence,
        assetDescriptor.definition,
        contentLibrary
      )
    : [];

  return {
    instanceId: presence.presenceId,
    kind: "npc",
    displayName: npcDefinition?.displayName ?? "NPC",
    assetDefinitionId: modelAssetDefinitionId,
    assetKind: assetDescriptor.assetKind,
    modelSourcePath: assetDescriptor.sourcePath,
    targetModelHeight: height,
    effectiveShaders,
    effectiveMaterialSlots,
    effectiveShader: effectiveShaders.surface ?? effectiveShaders.deform ?? effectiveShaders.effect,
    transform: {
      position: presence.transform.position,
      rotation: presence.transform.rotation,
      scale: presence.transform.scale
    },
    representationKey: `npc:${presence.npcDefinitionId}:${modelAssetDefinitionId ?? "capsule"}:${assetDescriptor.assetKind ?? "unknown"}:${assetDescriptor.sourcePath ?? "fallback"}:${height}:${radius}:${shaderRepresentationKey(effectiveShaders, effectiveMaterialSlots, presence.shaderParameterOverrides)}`,
    capsule: {
      height,
      radius,
      color: NPC_CAPSULE_COLOR
    }
  };
}

function createItemSceneObject(
  presence: RegionItemPresence,
  itemDefinition: ItemDefinition | null,
  contentLibrary?: ContentLibrarySnapshot
): SceneObject {
  const modelAssetDefinitionId = itemDefinition?.presentation.modelAssetDefinitionId ?? null;
  const assetDescriptor = getAssetSourceDescriptor(
    modelAssetDefinitionId,
    contentLibrary
  );
  const height = Math.max(itemDefinition?.presentation.modelHeight ?? 0.45, 0.1);
  const effectiveShaders = contentLibrary
    ? resolveEffectivePresenceShaderBindings(presence, assetDescriptor.definition, contentLibrary)
    : { surface: null, deform: null, effect: null };
  const effectiveMaterialSlots = contentLibrary
    ? resolveEffectivePresenceMaterialSlotBindings(
        presence,
        assetDescriptor.definition,
        contentLibrary
      )
    : [];

  return {
    instanceId: presence.presenceId,
    kind: "item",
    displayName: itemDefinition?.displayName ?? "Item",
    assetDefinitionId: modelAssetDefinitionId,
    assetKind: assetDescriptor.assetKind,
    modelSourcePath: assetDescriptor.sourcePath,
    targetModelHeight: height,
    effectiveShaders,
    effectiveMaterialSlots,
    effectiveShader: effectiveShaders.surface ?? effectiveShaders.deform ?? effectiveShaders.effect,
    transform: {
      position: presence.transform.position,
      rotation: presence.transform.rotation,
      scale: presence.transform.scale
    },
    representationKey: `item:${presence.itemDefinitionId}:${modelAssetDefinitionId ?? "cube"}:${assetDescriptor.assetKind ?? "unknown"}:${assetDescriptor.sourcePath ?? "fallback"}:${height}:${presence.quantity}:${shaderRepresentationKey(effectiveShaders, effectiveMaterialSlots, presence.shaderParameterOverrides)}`,
    capsule: null
  };
}

function getAssetSourceDescriptor(
  assetDefinitionId: string | null | undefined,
  contentLibrary?: ContentLibrarySnapshot
): {
  sourcePath: string | null;
  assetKind: AssetKind | null;
  definition: ReturnType<typeof getAssetDefinition>;
} {
  if (!assetDefinitionId || !contentLibrary) {
    return { sourcePath: null, assetKind: null, definition: null };
  }

  const definition = getAssetDefinition(contentLibrary, assetDefinitionId);
  return {
    sourcePath: definition?.source.relativeAssetPath ?? null,
    assetKind: definition?.assetKind ?? null,
    definition
  };
}

/**
 * Resolve a Player/NPC `modelAssetDefinitionId` against the entity-
 * owned `characterModelDefinitions` collection (post-Plan-038). Returns
 * the same shape as `getAssetSourceDescriptor` so the Player + NPC
 * scene-object factories can stay structurally identical to the asset
 * path. `definition` is always `null` because character models don't
 * carry shader-binding metadata (no surface slots, no deform / effect)
 * — the downstream `resolveEffectivePresenceShaderBindings` callers
 * already handle a null AssetDefinition gracefully.
 */
function getCharacterModelSourceDescriptor(
  modelDefinitionId: string | null | undefined,
  contentLibrary?: ContentLibrarySnapshot
): {
  sourcePath: string | null;
  assetKind: AssetKind | null;
  definition: ReturnType<typeof getAssetDefinition>;
} {
  if (!modelDefinitionId || !contentLibrary) {
    return { sourcePath: null, assetKind: null, definition: null };
  }

  const definition = getCharacterModelDefinition(
    contentLibrary,
    modelDefinitionId
  );
  return {
    sourcePath: definition?.source.relativeAssetPath ?? null,
    assetKind: definition ? "model" : null,
    definition: null
  };
}
