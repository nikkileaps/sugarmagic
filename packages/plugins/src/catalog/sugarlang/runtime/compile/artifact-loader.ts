/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/artifact-loader.ts
 *
 * Purpose: Loads the derived artifacts a deployed game shipped with -- the
 *   work a player's machine cannot do for itself.
 *
 * WHY A FETCH AND NOT A CACHE READ
 *   Studio and its Preview share an origin, so Preview can read the very
 *   IndexedDB the bake wrote. A deployed game cannot: different machine,
 *   empty storage, no Studio. What it has instead is the artifact FILE, which
 *   shipped in `assets/` and is served like any other asset.
 *
 * RESOLVE THROUGH `assetSources`, NEVER BY HARD-CODED URL
 *   The deploy stamps every entry with the deployed sha, and `/assets/*` is
 *   served `immutable` for a year. A hand-built `/assets/...` URL would be
 *   cached across deploys and never pick up a rebake.
 *
 * Exports:
 *   - loadSceneContextsFromArtifact
 *   - loadVariantsFromArtifact
 *
 * Implements: Plan 092 story 092.3
 *
 * Status: active
 */

import type { SceneContextModel } from "../contracts/scene-context";
import type { VariantCacheEntry } from "./variant-cache";
import {
  SUGARLANG_SCENE_CONTEXT_ASSET_PATH,
  SUGARLANG_VARIANT_ASSET_PATH
} from "./artifact-paths";

/**
 * One fetch shape for every artifact this game shipped with.
 *
 * RESOLVED THROUGH `assetSources`, NEVER BY HAND-BUILT URL -- see the module
 * header. Failure of any kind returns null: a deployed game must not fail to
 * boot because a file it ships is missing or unreadable. It teaches less; it
 * still plays.
 */
async function readArtifact(
  assetSources: Record<string, string> | undefined,
  assetPath: string,
  fetchImpl: typeof fetch
): Promise<unknown | null> {
  const url = assetSources?.[assetPath];
  if (!url) return null;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      console.warn(`[sugarlang] artifact ${response.status} at ${url}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[sugarlang] artifact unreadable at ${url}`, error);
    return null;
  }
}

/**
 * The graded line variants this game shipped with, or an empty array.
 *
 * Empty is a LEGAL QUIET STATE: a project with nothing graded ships no
 * entries, and every scripted line renders the authored text -- which is what
 * happened in production for months, so the caller logs the count.
 *
 * Shape-checked rather than trusted. This is fetched from a network and may
 * have been hand-edited; one malformed entry must not cost the rest.
 */
export async function loadVariantsFromArtifact(
  assetSources: Record<string, string> | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<VariantCacheEntry[]> {
  const parsed = await readArtifact(
    assetSources,
    SUGARLANG_VARIANT_ASSET_PATH,
    fetchImpl
  );
  const entries = (parsed as { variants?: unknown })?.variants;
  if (!Array.isArray(entries)) return [];

  return (entries as VariantCacheEntry[]).filter((entry) => {
    const key = entry?.key;
    const variant = entry?.variant;
    return Boolean(
      key?.lang &&
        key?.band &&
        key?.contentHash &&
        key?.variantPromptVersion &&
        typeof variant?.text === "string" &&
        variant.text.length > 0
    );
  });
}

/**
 * The scene context models this game shipped with, or an empty array.
 *
 * Empty is a LEGAL QUIET STATE, not an error: a project that was never baked
 * ships no artifact, and the Teacher simply has no situation for its scenes.
 * The caller logs the count so "zero" is visible rather than inferred.
 */
export async function loadSceneContextsFromArtifact(
  assetSources: Record<string, string> | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<SceneContextModel[]> {
  const url = assetSources?.[SUGARLANG_SCENE_CONTEXT_ASSET_PATH];
  if (!url) {
    return [];
  }

  let parsed: unknown;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      console.warn(
        `[sugarlang] scene-context artifact ${response.status} at ${url}`
      );
      return [];
    }
    parsed = await response.json();
  } catch (error) {
    // A deployed game must not fail to boot because an artifact is unreadable.
    // It teaches less; it still plays.
    console.warn("[sugarlang] scene-context artifact unreadable", error);
    return [];
  }

  const models = (parsed as { sceneContextModels?: unknown })?.sceneContextModels;
  if (!Array.isArray(models)) {
    return [];
  }
  // Shape-checked rather than trusted: this file is fetched from the network,
  // and a half-written or hand-edited one must not take the game down.
  return (models as SceneContextModel[]).filter(
    (model) => Boolean(model?.sceneId) && Array.isArray(model?.concepts)
  );
}
