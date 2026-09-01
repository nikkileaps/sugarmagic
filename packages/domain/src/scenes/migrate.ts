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
  RegionDocument,
  RegionItemPresence,
  RegionNPCPresence,
  RegionPlayerPresence,
  RegionSceneFolder
} from "../region-authoring";
import {
  createDefaultScene,
  createRegionSceneOverlay,
  DEFAULT_SCENE_ID,
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
  playerPresence: RegionPlayerPresence | null;
  npcPresences: RegionNPCPresence[];
  itemPresences: RegionItemPresence[];
}

/**
 * Compose one region with the active Scene's overlay for that region
 * (epic #226). Two layers: the region is the world at rest -- its
 * dressing AND its residents -- and the Scene overlay is a diff that
 * adds, suppresses, and restyles. A null scene, or a Scene with no
 * overlay for this region, yields the region alone: a populated place,
 * which is what free roam composes.
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
  const overlay = scene?.regionOverlays[region.identity.id] ?? null;
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
    defaultScene = createDefaultScene({
      sceneId: DEFAULT_SCENE_ID,
      displayName: "Scene 1"
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

    // Presence move: into the default Scene's overlay for this
    // region — but never clobber an overlay that already exists
    // (a half-migrated file re-encountered keeps first-run data).
    const hasPresences =
      (legacy.itemPresences?.length ?? 0) > 0 ||
      (legacy.npcPresences?.length ?? 0) > 0 ||
      legacy.playerPresence != null;
    if (hasPresences) {
      const target = ensureDefaultScene();
      if (!target.regionOverlays[region.identity.id]) {
        target.regionOverlays[region.identity.id] =
          createRegionSceneOverlay({
            itemPresences: legacy.itemPresences ?? [],
            npcPresences: legacy.npcPresences ?? [],
            playerPresence: legacy.playerPresence ?? null
          });
      }
    }
    return base;
  });

  if (scenes.length === 0) {
    ensureDefaultScene();
  }

  return { scenes, regions, didMigrate };
}
