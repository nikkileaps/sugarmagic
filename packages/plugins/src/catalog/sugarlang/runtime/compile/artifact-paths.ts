/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/artifact-paths.ts
 *
 * Purpose: Where sugarlang's derived artifacts live inside a project, named
 *   once so the Studio side that writes them and the runtime side that reads
 *   them cannot disagree.
 *
 * Exports:
 *   - SUGARLANG_SCENE_CONTEXT_ASSET_PATH
 *   - SUGARLANG_VARIANT_ASSET_PATH
 *   - SUGARLANG_ARTIFACT_ASSET_PATHS
 *   - SUGARLANG_ARTIFACT_SCHEMA_VERSION
 *
 * Relationships:
 *   - Written by ui/shell/editor-support (Studio only, needs a directory
 *     handle). Read by manifest.ts at runtime init, in BOTH hosts.
 *   - Lives under runtime/ rather than ui/shell/ for that reason: a deployed
 *     game must not import Studio code.
 *
 * Implements: Plan 092 story 092.3
 *
 * Status: active
 */

/**
 * STABLE, not content-hashed. The deploy stamps every `assetSources` URL with
 * a hash of that file's own bytes, so cache-busting is already handled -- and
 * a stable name means the declared path list never changes, so writing an
 * artifact never touches the project session.
 */
export const SUGARLANG_SCENE_CONTEXT_ASSET_PATH =
  "assets/sugarlang/scene-contexts.json";

/** Stable, same reasoning. */
export const SUGARLANG_VARIANT_ASSET_PATH = "assets/sugarlang/variants.json";

/** Every path this plugin declares, for the project's asset collector. */
export const SUGARLANG_ARTIFACT_ASSET_PATHS: readonly string[] = [
  SUGARLANG_SCENE_CONTEXT_ASSET_PATH,
  SUGARLANG_VARIANT_ASSET_PATH
];

/** Bumped when an artifact file's shape changes in a way a reader must notice.
 *  v2: scene-context entries carry `regionId`; v1 wrote the same value under
 *  the old name "sceneId" and is still accepted by the loader, mapped on
 *  read. */
export const SUGARLANG_ARTIFACT_SCHEMA_VERSION = 2;
