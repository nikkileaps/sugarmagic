/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/cache-memory.ts
 *
 * Purpose: Reserves the in-memory compile cache implementation used by published and fallback runtime paths.
 *
 * Exports:
 *   - MemoryCompileCache
 *
 * Relationships:
 *   - Implements SugarlangCompileCache.
 *   - Will be consumed by preview fallback and published runtime flows in Epic 6.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 6)
 */

import type { CompiledSceneLexicon } from "../types";
import { BaseSugarlangCompileCache } from "./sugarlang-compile-cache";

export class MemoryCompileCache extends BaseSugarlangCompileCache {
  override async get(_key: string): Promise<CompiledSceneLexicon | null> {
    throw new Error("TODO: Epic 6");
  }

  override async set(
    _key: string,
    _value: CompiledSceneLexicon
  ): Promise<void> {
    throw new Error("TODO: Epic 6");
  }
}
