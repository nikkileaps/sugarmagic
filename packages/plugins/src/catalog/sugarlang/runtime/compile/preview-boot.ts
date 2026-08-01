/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/preview-boot.ts
 *
 * Purpose: Builds and hydrates sugarlang preview boot payloads carrying cached scene lexicons.
 *
 * Exports:
 *   - SugarlangPreviewBootPayload
 *   - buildSugarlangPreviewBootPayload
 *   - extractSugarlangPreviewBootLexicons
 *
 * Relationships:
 *   - Depends on the compile cache and scene authoring contexts.
 *   - Is consumed by Studio preview handoff and runtime plugin initialization.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { SceneVocabularyModel } from "../types";
import type { SceneContextModel } from "../contracts/scene-context";
import type { SugarlangSceneContextCache } from "./scene-context-cache";
import { SCENE_CONTEXT_PROMPT_VERSION } from "./scene-context-extractor";
import { compileSugarlangScene } from "./compile-sugarlang-scene";
import type { SceneAuthoringContext } from "./scene-traversal";
import type { SugarlangCompileCache } from "./sugarlang-compile-cache";
import type { LexicalAtlasProvider } from "../types";
import type { MorphologyLoader } from "../classifier/morphology-loader";

export interface SugarlangPreviewBootPayload {
  compiledScenes: SceneVocabularyModel[];
  /** IDB workspaceId the Studio used when baking variants. Runtime reads it to open the same db. */
  studioWorkspaceId?: string;
  /**
   * What each scene's content is ABOUT (Plan 090.1).
   *
   * Rides the boot payload because the runtime has no other way to get it: its
   * caches are in-memory and a deployed game cannot open Studio's IndexedDB.
   * Absent when the scene was never built, which is a legal quiet state -- the
   * Teacher simply has no situation for that scene.
   */
  sceneContextModels?: SceneContextModel[];
}

export async function buildSugarlangPreviewBootPayload(
  scenes: SceneAuthoringContext[],
  cache: SugarlangCompileCache,
  atlas: LexicalAtlasProvider,
  morphology: MorphologyLoader,
  /**
   * Optional: the Studio-side scene-context build cache. Omit it and preview
   * simply runs without situations, exactly as it does today.
   */
  sceneContextCache?: SugarlangSceneContextCache,
  sceneContextPromptVersion: string = SCENE_CONTEXT_PROMPT_VERSION
): Promise<SugarlangPreviewBootPayload> {
  const compiledScenes: SceneVocabularyModel[] = [];
  const sceneContextModels: SceneContextModel[] = [];

  for (const scene of [...scenes].sort((left, right) =>
    left.sceneId.localeCompare(right.sceneId)
  )) {
    const expected = compileSugarlangScene(
      scene,
      atlas,
      morphology,
      "runtime-preview"
    );
    const cached = await cache.get(
      scene.sceneId,
      expected.contentHash,
      "runtime-preview"
    );
    if (cached) {
      compiledScenes.push(cached);
    }

    if (!sceneContextCache) continue;
    // Same content hash the build keyed on, so a scene edited since the last
    // Rebuild misses here and ships no situation rather than a stale one.
    const contextKey = {
      contentHash: expected.contentHash,
      supportLanguage: scene.supportLanguage,
      promptVersion: sceneContextPromptVersion
    };
    const contextEntry = await sceneContextCache.get(contextKey);
    if (contextEntry) {
      sceneContextModels.push(contextEntry.model);
    } else {
      // A miss here is invisible downstream -- the HUD just says "(not built)"
      // whether the build never ran or the key simply disagrees. Print both
      // sides so the difference is readable instead of inferred.
      console.warn(
        `[sugarlang preview] no scene context for "${scene.sceneId}"`,
        {
          lookedUp: contextKey,
          availableInCache: await sceneContextCache.listEntries()
        }
      );
    }
  }

  return {
    compiledScenes,
    ...(sceneContextModels.length > 0 ? { sceneContextModels } : {})
  };
}

export function extractSugarlangPreviewBootLexicons(
  payload: unknown
): SceneVocabularyModel[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const record = payload as Partial<SugarlangPreviewBootPayload>;
  return Array.isArray(record.compiledScenes)
    ? (record.compiledScenes as SceneVocabularyModel[])
    : [];
}

export function extractSugarlangPreviewBootSceneContexts(
  payload: unknown
): SceneContextModel[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const record = payload as Partial<SugarlangPreviewBootPayload>;
  return Array.isArray(record.sceneContextModels)
    ? (record.sceneContextModels as SceneContextModel[])
    : [];
}

export function extractSugarlangStudioWorkspaceId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Partial<SugarlangPreviewBootPayload>;
  return typeof record.studioWorkspaceId === "string" ? record.studioWorkspaceId : null;
}
