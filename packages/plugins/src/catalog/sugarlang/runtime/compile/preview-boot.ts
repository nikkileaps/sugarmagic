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

import type { CompiledSceneLexicon } from "../types";
import { compileSugarlangScene } from "./compile-sugarlang-scene";
import type { SceneAuthoringContext } from "./scene-traversal";
import type { SugarlangCompileCache } from "./sugarlang-compile-cache";
import type { LexicalAtlasProvider } from "../types";
import type { MorphologyLoader } from "../classifier/morphology-loader";

export interface SugarlangPreviewBootPayload {
  compiledScenes: CompiledSceneLexicon[];
}

export async function buildSugarlangPreviewBootPayload(
  scenes: SceneAuthoringContext[],
  cache: SugarlangCompileCache,
  atlas: LexicalAtlasProvider,
  morphology: MorphologyLoader
): Promise<SugarlangPreviewBootPayload> {
  const compiledScenes: CompiledSceneLexicon[] = [];

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
  }

  return { compiledScenes };
}

export function extractSugarlangPreviewBootLexicons(
  payload: unknown
): CompiledSceneLexicon[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const record = payload as Partial<SugarlangPreviewBootPayload>;
  return Array.isArray(record.compiledScenes)
    ? (record.compiledScenes as CompiledSceneLexicon[])
    : [];
}
