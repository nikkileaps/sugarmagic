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
import type { RegionDocument } from "./region-authoring";

export function collectFileBackedAssetPaths(input: {
  contentLibrary: ContentLibrarySnapshot;
  itemDefinitions?: ItemDefinition[];
  documentDefinitions?: DocumentDefinition[];
  /** Plan 069.8 — baked navmesh artifacts (`region.navMesh.assetPath`) are
   *  file-backed too; without them the asset-source store never re-loads the
   *  `.bin` on project open, so NPC pathfinding silently falls back to
   *  straight-line after a restart (and deployed games ship no navmesh). */
  regions?: RegionDocument[];
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
  return paths.sort();
}
