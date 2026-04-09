/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/sugarlang-compile-cache.ts
 *
 * Purpose: Reserves the compile-cache interface and abstract base owned by the scene compiler.
 *
 * Exports:
 *   - SugarlangCompileCache
 *   - BaseSugarlangCompileCache
 *
 * Relationships:
 *   - Depends on the compiled scene-lexicon contract type.
 *   - Will be implemented by memory and IndexedDB caches in Epic 6.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 6)
 */

import type { CompiledSceneLexicon } from "../types";

export interface SugarlangCompileCache {
  get: (key: string) => Promise<CompiledSceneLexicon | null>;
  set: (key: string, value: CompiledSceneLexicon) => Promise<void>;
  clear: () => Promise<void>;
}

export abstract class BaseSugarlangCompileCache implements SugarlangCompileCache {
  async get(_key: string): Promise<CompiledSceneLexicon | null> {
    throw new Error("TODO: Epic 6");
  }

  async set(_key: string, _value: CompiledSceneLexicon): Promise<void> {
    throw new Error("TODO: Epic 6");
  }

  async clear(): Promise<void> {
    throw new Error("TODO: Epic 6");
  }
}
