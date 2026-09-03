/**
 * packages/domain/src/asset-paths.ts
 *
 * Purpose: the single collector of every file-backed authored
 * asset path in a project (models, animation GLBs, audio clips,
 * textures, painted masks, item thumbnails, document image
 * pages). Two consumers, one truth:
 *
 *   - Studio's asset-source store (packages/shell) reads these
 *     paths from project file handles into blob URLs.
 *   - The published-web boot.json (packages/plugins) maps them to
 *     site-relative URLs so the DEPLOYED game can fetch the same
 *     files (the deploy workflow ships the `assets/` directory
 *     next to boot.json).
 *
 * Duplicating this list was how deployed audio silently broke
 * (2026-07-05): the publish side had no list at all and baked an
 * empty asset-source map.
 *
 * Status: active
 */

import type { ContentLibrarySnapshot } from "./content-library";
import type { DocumentDefinition } from "./document-definition";
import type { ItemDefinition } from "./item-definition";
import type { PluginConfigurationRecord } from "./plugins";
import type { RegionDocument } from "./region-authoring";
import type { Scene } from "./scenes";

/**
 * The config key a plugin writes its file-backed asset paths under.
 *
 * Generic on purpose: this module must never learn the name of any plugin.
 * A plugin that produces a derived artifact the runtime cannot rebuild (see
 * ADR 005 rule 3) declares the file here, and it is collected on exactly the
 * same footing as a model or an audio clip.
 */
export const PLUGIN_ASSET_PATHS_CONFIG_KEY = "fileBackedAssetPaths";

export function collectFileBackedAssetPaths(input: {
  contentLibrary: ContentLibrarySnapshot;
  itemDefinitions?: ItemDefinition[];
  documentDefinitions?: DocumentDefinition[];
  /** Plan 069.8 — baked navmesh artifacts (`region.navMesh.assetPath`) are
   *  file-backed too; without them the asset-source store never re-loads the
   *  `.bin` on project open, so NPC pathfinding silently falls back to
   *  straight-line after a restart (and deployed games ship no navmesh). */
  regions?: RegionDocument[];
  /** Scenes carry their own baked navmesh when their composition changes
   *  what blocks movement. Missed here, a deploy ships a Scene pointing at
   *  a `.bin` that is not in the bundle -- and the runtime falls back to
   *  straight-line steering without saying anything. */
  scenes?: Scene[];
  /** Plan 092.2 — a DISABLED plugin's files are skipped, so uninstalling or
   *  switching one off leaves a project that still opens and still deploys.
   *  That property is the reason this is read generically rather than by
   *  plugin id. */
  pluginConfigurations?: PluginConfigurationRecord[];
}): string[] {
  const sources = [
    ...(input.contentLibrary.assetDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(input.contentLibrary.audioClipDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(input.contentLibrary.characterModelDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(input.contentLibrary.characterAnimationDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(input.contentLibrary.animationLibraryDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(input.contentLibrary.textureDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(input.contentLibrary.maskTextureDefinitions ?? []).map(
      (definition) => definition.source
    )
  ];

  const paths = sources.map((source) => source.relativeAssetPath);
  for (const itemDefinition of input.itemDefinitions ?? []) {
    if (itemDefinition.presentation.thumbnailAssetPath) {
      paths.push(itemDefinition.presentation.thumbnailAssetPath);
    }
  }
  for (const documentDefinition of input.documentDefinitions ?? []) {
    for (const pagePath of documentDefinition.imagePages) {
      paths.push(pagePath);
    }
  }
  for (const region of input.regions ?? []) {
    if (region.navMesh?.assetPath) {
      paths.push(region.navMesh.assetPath);
    }
  }
  for (const scene of input.scenes ?? []) {
    if (scene.navMesh?.assetPath) {
      paths.push(scene.navMesh.assetPath);
    }
  }
  for (const record of input.pluginConfigurations ?? []) {
    if (!record.enabled) {
      continue;
    }
    // `config` is opaque to the domain, so the shape is checked rather than
    // trusted: a plugin writing something else under this key must not be able
    // to break opening a project.
    const declared = record.config?.[PLUGIN_ASSET_PATHS_CONFIG_KEY];
    if (!Array.isArray(declared)) {
      continue;
    }
    for (const entry of declared) {
      if (typeof entry === "string" && entry.length > 0) {
        paths.push(entry);
      }
    }
  }
  return paths.sort();
}
