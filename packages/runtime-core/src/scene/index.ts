import type { RegionDocument, PlacedAssetInstance } from "@sugarmagic/domain";

/**
 * Platform-agnostic scene loading semantics.
 *
 * runtime-core owns the logic of resolving a RegionDocument into
 * a scene description. Platform hosts consume this description
 * to produce renderer-specific objects.
 */

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

export interface SceneObject {
  instanceId: string;
  assetDefinitionId: string;
  transform: SceneObjectTransform;
}

export interface SceneDelta {
  added: SceneObject[];
  updated: SceneObject[];
  removed: string[];
}

export function resolveSceneObjects(
  region: RegionDocument
): SceneObject[] {
  return region.scene.placedAssets.map((asset: PlacedAssetInstance) => ({
    instanceId: asset.instanceId,
    assetDefinitionId: asset.assetDefinitionId,
    transform: {
      position: asset.transform.position,
      rotation: asset.transform.rotation,
      scale: asset.transform.scale
    }
  }));
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
