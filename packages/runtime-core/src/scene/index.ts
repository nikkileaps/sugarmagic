import {
  getAssetDefinition,
  type ContentLibrarySnapshot,
  type NPCDefinition,
  type PlayerDefinition,
  type RegionDocument,
  type PlacedAssetInstance,
  type RegionNPCPresence,
  type RegionPlayerPresence
} from "@sugarmagic/domain";

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

export type SceneObjectKind = "asset" | "player" | "npc";

export interface SceneObject {
  instanceId: string;
  kind: SceneObjectKind;
  displayName: string;
  assetDefinitionId: string | null;
  modelSourcePath: string | null;
  targetModelHeight: number | null;
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

function createPlacedAssetSceneObject(
  asset: PlacedAssetInstance,
  contentLibrary?: ContentLibrarySnapshot
): SceneObject {
  const sourcePath = getAssetSourcePath(asset.assetDefinitionId, contentLibrary);
  return {
    instanceId: asset.instanceId,
    kind: "asset",
    displayName: asset.displayName,
    assetDefinitionId: asset.assetDefinitionId,
    modelSourcePath: sourcePath,
    targetModelHeight: null,
    transform: {
      position: asset.transform.position,
      rotation: asset.transform.rotation,
      scale: asset.transform.scale
    },
    representationKey: `asset:${asset.assetDefinitionId}:${sourcePath ?? "fallback"}`,
    capsule: null
  };
}

function createPlayerSceneObject(
  presence: RegionPlayerPresence,
  playerDefinition: PlayerDefinition | null,
  contentLibrary?: ContentLibrarySnapshot
): SceneObject {
  const modelAssetDefinitionId = playerDefinition?.presentation.modelAssetDefinitionId ?? null;
  const modelSourcePath = getAssetSourcePath(modelAssetDefinitionId, contentLibrary);
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
    modelSourcePath,
    targetModelHeight: height,
    transform: {
      position: presence.transform.position,
      rotation: presence.transform.rotation,
      scale: presence.transform.scale
    },
    representationKey: `player:${modelAssetDefinitionId ?? "capsule"}:${modelSourcePath ?? "fallback"}:${height}:${radius}`,
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
  const modelSourcePath = getAssetSourcePath(modelAssetDefinitionId, contentLibrary);
  const height = Math.max(npcDefinition?.presentation.modelHeight ?? 1.7, 0.5);
  const radius = Math.max(0.25, Math.min(0.45, height * 0.22));

  return {
    instanceId: presence.presenceId,
    kind: "npc",
    displayName: npcDefinition?.displayName ?? "NPC",
    assetDefinitionId: modelAssetDefinitionId,
    modelSourcePath,
    targetModelHeight: height,
    transform: {
      position: presence.transform.position,
      rotation: presence.transform.rotation,
      scale: presence.transform.scale
    },
    representationKey: `npc:${presence.npcDefinitionId}:${modelAssetDefinitionId ?? "capsule"}:${modelSourcePath ?? "fallback"}:${height}:${radius}`,
    capsule: {
      height,
      radius,
      color: NPC_CAPSULE_COLOR
    }
  };
}

function getAssetSourcePath(
  assetDefinitionId: string | null | undefined,
  contentLibrary?: ContentLibrarySnapshot
): string | null {
  if (!assetDefinitionId || !contentLibrary) return null;
  const definition = getAssetDefinition(contentLibrary, assetDefinitionId);
  return definition?.source.relativeAssetPath ?? null;
}
