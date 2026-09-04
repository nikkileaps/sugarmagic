/**
 * packages/domain/src/scenes/migrate.ts
 *
 * Purpose: Pure, idempotent migration from the pre-058 shape
 * (each region carries a `scene` nest of placements; project has
 * no `scenes`) to the Base + Overlay shape (region carries
 * base-scope `placedAssets` + `folders`; presences live on the
 * project's Scenes as per-region overlays).
 *
 * Called from BOTH load paths so old data upgrades wherever it
 * is encountered:
 *   - `createAuthoringSession` (Studio project load)
 *   - the runtime boot path (a stale committed boot.json from a
 *     pre-058 Studio save must still boot the new engine)
 *
 * Idempotency comes from stripping: after one pass no region
 * carries a legacy `scene` key, so re-running is a no-op.
 *
 * Implements: Plan 058 §058.1 (Base + Overlay pattern)
 *
 * Status: active
 */

import type {
  PlacedAssetInstance,
  PlacedLight,
  RegionDocument,
  RegionNavMeshArtifact,
  RegionItemPresence,
  RegionNPCPresence,
  RegionPlayerPresence,
  RegionSceneFolder
} from "../region-authoring";
import {
  createDefaultScene,
  createRegionSceneOverlay,
  DEFAULT_SCENE_ID,
  type RegionSceneOverlay,
  type Scene
} from "./index";

/**
 * Plan 058 Pattern 1 made literal: the composed Base + Overlay
 * view of one region under one Scene. Deliberately the SAME
 * shape as the pre-058 `region.scene` nest so consumers of the
 * composed world (spawn pipeline, scene explorer read path)
 * migrate by renaming their source, not by restructuring.
 */
export interface ComposedRegionContents {
  folders: RegionSceneFolder[];
  placedAssets: PlacedAssetInstance[];
  placedLights: PlacedLight[];
  playerPresence: RegionPlayerPresence | null;
  npcPresences: RegionNPCPresence[];
  itemPresences: RegionItemPresence[];
}

/**
 * Whether this Scene happens in this region.
 *
 * A Scene happens in exactly one region, so every caller holding a Scene
 * and a region has to ask whether they match. This is the one place that
 * answers it, for the overlay and for the Scene's own fields alike.
 */
export function sceneDressesRegion(
  scene: Scene | null | undefined,
  regionId: string
): boolean {
  // [LAW:single-enforcer] The one comparison.
  return Boolean(scene && scene.regionId === regionId);
}

/**
 * The Scene's overlay when it dresses this region, otherwise nothing.
 *
 * Studio panels, the viewport brushes, and the command executor all route
 * through here rather than each comparing ids themselves.
 */
export function sceneOverlayForRegion(
  scene: Scene | null | undefined,
  regionId: string
): RegionSceneOverlay | null {
  return sceneDressesRegion(scene, regionId) ? scene!.overlay : null;
}

/**
 * The navmesh to path against in this region: the Scene's when it dresses
 * this region and baked one, otherwise the region's own.
 *
 * A Scene's navmesh is a Scene field rather than part of the overlay, so it
 * needs the same region test the overlay gets. Without it, walking through
 * a doorway pathed the new region against the navmesh baked for the Scene
 * in the region just left.
 */
export function navMeshForRegion(
  scene: Scene | null | undefined,
  region: RegionDocument
): RegionNavMeshArtifact | null {
  const fromScene = sceneDressesRegion(scene, region.identity.id)
    ? (scene?.navMesh ?? null)
    : null;
  return fromScene ?? region.navMesh ?? null;
}

/**
 * Compose one region with the active Scene's overlay for that region
 * (epic #226). Two layers: the region is the world at rest -- its
 * dressing AND its residents -- and the Scene overlay is a diff that
 * adds, suppresses, and restyles. A null scene, or a Scene that happens
 * somewhere else, yields the region alone: a populated place, which is
 * what free roam composes.
 *
 * Suppression names region-owned ids, so a Scene hides a resident or a
 * prop without the overlay holding a copy of it. It cannot reach the
 * overlay's own content -- a Scene that does not want something simply
 * does not add it.
 *
 * Pure; call at the spawn/read seam, never per-tick.
 */
export function composeRegionContents(
  region: RegionDocument,
  scene: Scene | null
): ComposedRegionContents {
  const overlay = sceneOverlayForRegion(scene, region.identity.id);
  const suppressed = new Set(overlay?.suppressedRegionIds ?? []);
  const regionPlayerPresence =
    region.playerPresence && !suppressed.has(region.playerPresence.presenceId)
      ? region.playerPresence
      : null;
  return {
    folders: [...region.folders, ...(overlay?.folders ?? [])],
    placedAssets: [
      ...region.placedAssets.filter(
        (asset) => !suppressed.has(asset.instanceId)
      ),
      ...(overlay?.placedAssets ?? [])
    ],
    placedLights: [
      ...region.placedLights.filter(
        (light) => !suppressed.has(light.instanceId)
      ),
      ...(overlay?.placedLights ?? [])
    ],
    // Exactly one player spawn: the Scene's answer wins where it has one,
    // otherwise the region's. Reading the overlay alone used to be the
    // whole rule, so a region start plus a Scene start meant two spawns.
    playerPresence: overlay?.playerPresence ?? regionPlayerPresence,
    npcPresences: [
      ...region.npcPresences.filter(
        (presence) => !suppressed.has(presence.presenceId)
      ),
      ...(overlay?.npcPresences ?? [])
    ],
    itemPresences: [
      ...region.itemPresences.filter(
        (presence) => !suppressed.has(presence.presenceId)
      ),
      ...(overlay?.itemPresences ?? [])
    ]
  };
}

/** The pre-058 nest as it appears in on-disk region JSON. */
interface LegacyRegionSceneNest {
  folders?: RegionSceneFolder[] | null;
  placedAssets?: PlacedAssetInstance[] | null;
  playerPresence?: RegionPlayerPresence | null;
  npcPresences?: RegionNPCPresence[] | null;
  itemPresences?: RegionItemPresence[] | null;
}

type RegionWithLegacyScene = RegionDocument & {
  scene?: LegacyRegionSceneNest | null;
};

export interface MigrateToScenesResult {
  scenes: Scene[];
  regions: RegionDocument[];
  /** True when this call actually moved data (a legacy nest was
   *  found, or the default Scene had to be created). Callers can
   *  use it to mark the project dirty / log the upgrade. */
  didMigrate: boolean;
}

function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Lift legacy per-region `scene` nests into (a) base-scope fields
 * on the region and (b) the default Scene's overlays. Ensures the
 * project always has at least one Scene.
 */
export function migrateToScenes(input: {
  scenes: Scene[];
  regions: RegionDocument[];
}): MigrateToScenesResult {
  let didMigrate = false;
  const scenes = [...input.scenes];

  let defaultScene = scenes.find(
    (scene) => scene.sceneId === DEFAULT_SCENE_ID
  );
  const ensureDefaultScene = (): Scene => {
    if (defaultScene) return defaultScene;
    // Prefer an existing first Scene as the migration target when
    // the author already renamed / re-created scenes; only mint
    // the well-known default when the project has none at all.
    if (scenes.length > 0) {
      defaultScene = scenes[0];
      return defaultScene!;
    }
    // A project with regions and no Scenes at all: the minted Scene has
    // to name somewhere, and the project's first region is the only
    // information there is. A Scene naming nowhere would be invalid.
    defaultScene = createDefaultScene({
      sceneId: DEFAULT_SCENE_ID,
      displayName: "Scene 1",
      regionId: input.regions[0]?.identity.id ?? ""
    });
    scenes.push(defaultScene);
    didMigrate = true;
    return defaultScene;
  };

  const regions = input.regions.map((region) => {
    const legacy = (region as RegionWithLegacyScene).scene;
    // Strip the legacy key even when it's empty/null so the
    // output shape is clean and the pass is idempotent.
    const { scene: _legacyScene, ...regionRest } =
      region as RegionWithLegacyScene;
    const base: RegionDocument = {
      ...(regionRest as RegionDocument),
      placedAssets: region.placedAssets ?? [],
      folders: region.folders ?? []
    };
    if (!legacy) {
      return base;
    }
    didMigrate = true;

    // Base-scope hoist: legacy placedAssets + folders become the
    // region's always-visible layer (Plan 058 migration default —
    // preserves current behavior; authors demote assets to a
    // Scene overlay later via the Scope dropdown).
    base.placedAssets = dedupeByKey(
      [...base.placedAssets, ...(legacy.placedAssets ?? [])],
      (asset) => asset.instanceId
    );
    base.folders = dedupeByKey(
      [...base.folders, ...(legacy.folders ?? [])],
      (folder) => folder.folderId
    );

    // Presence hoist: a pre-058 file nested its presences under the
    // region, which is where epic #226 puts them again — so they come
    // straight back out onto the region rather than detouring through a
    // Scene overlay. Deduped by presenceId so re-running is a no-op.
    base.npcPresences = dedupeByKey(
      [...(base.npcPresences ?? []), ...(legacy.npcPresences ?? [])],
      (presence) => presence.presenceId
    );
    base.itemPresences = dedupeByKey(
      [...(base.itemPresences ?? []), ...(legacy.itemPresences ?? [])],
      (presence) => presence.presenceId
    );
    base.playerPresence = base.playerPresence ?? legacy.playerPresence ?? null;
    return base;
  });

  if (scenes.length === 0) {
    ensureDefaultScene();
  }

  // A Scene still naming nowhere gets the project's first region. This is
  // the floor under `normalizeScenes`, which fills a Scene in from the one
  // before it: that cannot help the FIRST Scene, and a project's opening
  // Scene naming nowhere is unenterable. Runs here because this is the
  // pass that holds the regions.
  const firstRegionId = regions[0]?.identity.id ?? "";
  if (firstRegionId.length > 0) {
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index]!;
      if (scene.regionId.length > 0) continue;
      scenes[index] = { ...scene, regionId: firstRegionId };
      didMigrate = true;
    }
  }

  return { scenes, regions, didMigrate };
}
