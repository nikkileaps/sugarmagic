/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/runtime-cache-state.ts
 *
 * Purpose: Owns the shared in-memory runtime cache used by sugarlang preview and published sessions.
 *
 * Exports:
 *   - getSugarlangRuntimeCompileCache
 *   - seedSugarlangRuntimeCompileCache
 *   - clearSugarlangRuntimeCompileCache
 *
 * Relationships:
 *   - Depends on MemoryCompileCache as the single runtime-side cache implementation.
 *   - Is seeded from plugin boot payloads during runtime plugin initialization.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { CompiledSceneLexicon } from "../types";
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
