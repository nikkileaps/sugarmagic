/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/runtime-cache-state.ts
 *
 * Purpose: Owns the shared in-memory runtime cache used by sugarlang preview and published sessions.
 *
 * THE RUNTIME NEVER TOUCHES INDEXEDDB, AND THAT IS THE POINT
 *   Everything here is in MEMORY, filled by Studio at boot. IndexedDB is a
 *   Studio-side BUILD cache so a rebuild does not re-bill unchanged scenes; it
 *   is not a transport. A deployed game is a different origin with no such
 *   database, so anything the runtime needs must arrive through a boot payload.
 *   Two consequences worth knowing: a page reload re-seeds from scratch, and the
 *   runtime cannot build anything itself -- which is why extraction is a
 *   Studio-only pass.
 *
 * Exports:
 *   - getSugarlangRuntimeCompileCache
 *   - seedSugarlangRuntimeCompileCache
 *   - clearSugarlangRuntimeCompileCache
 *   - getSugarlangRuntimeSceneContext
 *   - seedSugarlangRuntimeSceneContext
 *   - clearSugarlangRuntimeSceneContext
 *
 * Relationships:
 *   - Depends on MemoryCompileCache as the single runtime-side cache implementation.
 *   - Is seeded from plugin boot payloads during runtime plugin initialization.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First;
 *   Plan 090 story 090.1
 *
 * Status: active
 */

import type { CompiledSceneLexicon } from "../types";
import type { SceneContextModel } from "../contracts/scene-context";
import { MemoryCompileCache } from "./cache-memory";

const runtimeCompileCache = new MemoryCompileCache({
  maxEntries: 256,
  maxBytes: 32 * 1024 * 1024
});

export function getSugarlangRuntimeCompileCache(): MemoryCompileCache {
  return runtimeCompileCache;
}

export async function seedSugarlangRuntimeCompileCache(
  lexicons: CompiledSceneLexicon[]
): Promise<void> {
  for (const lexicon of lexicons) {
    await runtimeCompileCache.set(lexicon);
  }
}

export async function clearSugarlangRuntimeCompileCache(): Promise<void> {
  await runtimeCompileCache.invalidate();
}

/**
 * What each scene's authored content is ABOUT, by sceneId.
 *
 * The cached, unchanging half of a SITUATION. 090.3 overlays the live half --
 * who is ACTUALLY present, met/unmet, quest stage, time of day -- to produce the
 * thing the Teacher reads. A model here describes the scene as AUTHORED, so
 * reading it as if it were the situation will happily describe an NPC who is
 * not standing there.
 *
 * Plain Map rather than a bounded cache: one small model per scene, seeded once
 * at boot and never evicted. There is nothing to evict against -- unlike the
 * compile cache, nothing here is recomputable at runtime.
 */
const runtimeSceneContexts = new Map<string, SceneContextModel>();

export function getSugarlangRuntimeSceneContext(
  sceneId: string
): SceneContextModel | undefined {
  return runtimeSceneContexts.get(sceneId);
}

export function seedSugarlangRuntimeSceneContext(
  models: SceneContextModel[]
): void {
  for (const model of models) {
    runtimeSceneContexts.set(model.sceneId, model);
  }
}

export function clearSugarlangRuntimeSceneContext(): void {
  runtimeSceneContexts.clear();
}
