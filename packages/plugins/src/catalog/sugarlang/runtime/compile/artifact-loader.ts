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
 *
 * Implements: Plan 092 story 092.3
 *
 * Status: active
 */

import type { SceneContextModel } from "../contracts/scene-context";
import { SUGARLANG_SCENE_CONTEXT_ASSET_PATH } from "./artifact-paths";

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
