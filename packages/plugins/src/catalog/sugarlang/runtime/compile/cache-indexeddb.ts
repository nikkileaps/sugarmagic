/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/cache-indexeddb.ts
 *
 * Purpose: Reserves the IndexedDB-backed compile cache implementation for Studio and preview use.
 *
 * Exports:
 *   - IndexedDBCompileCache
 *
 * Relationships:
 *   - Implements SugarlangCompileCache.
 *   - Will be consumed by authoring-preview and runtime-preview flows in Epic 6.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 6)
 */

import type { CompiledSceneLexicon } from "../types";
import { BaseSugarlangCompileCache } from "./sugarlang-compile-cache";

export class IndexedDBCompileCache extends BaseSugarlangCompileCache {
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
