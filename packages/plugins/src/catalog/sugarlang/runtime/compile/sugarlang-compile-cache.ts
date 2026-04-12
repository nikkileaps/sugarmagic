/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/sugarlang-compile-cache.ts
 *
 * Purpose: Defines the canonical cache interface for compiled sugarlang scene lexicons.
 *
 * Exports:
 *   - CacheEntryMeta
 *   - createCompileCacheKey
 *   - SugarlangCompileCache
 *   - BaseSugarlangCompileCache
 *
 * Relationships:
 *   - Depends on the compiled scene-lexicon contract type.
 *   - Is implemented by the memory and IndexedDB cache backends.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { CompiledSceneLexicon } from "../types";

export interface CacheEntryMeta {
  cacheKey: string;
  sceneId: string;
  contentHash: string;
  profile: RuntimeCompileProfile;
  estimatedBytes: number;
  accessOrdinal: number;
}

export function createCompileCacheKey(
  sceneId: string,
  contentHash: string,
  profile: RuntimeCompileProfile
): string {
  return `${profile}:${sceneId}:${contentHash}`;
}

export interface SugarlangCompileCache {
  get: (
    sceneId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ) => Promise<CompiledSceneLexicon | null>;
  set: (lexicon: CompiledSceneLexicon) => Promise<void>;
  has: (
    sceneId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ) => Promise<boolean>;
  invalidate: (sceneId?: string) => Promise<void>;
  listEntries: () => Promise<CacheEntryMeta[]>;
}

export abstract class BaseSugarlangCompileCache implements SugarlangCompileCache {
  abstract get(
    sceneId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ): Promise<CompiledSceneLexicon | null>;

  abstract set(lexicon: CompiledSceneLexicon): Promise<void>;

  async has(
    sceneId: string,
    contentHash: string,
    profile: RuntimeCompileProfile
  ): Promise<boolean> {
    return (await this.get(sceneId, contentHash, profile)) !== null;
  }

  abstract invalidate(sceneId?: string): Promise<void>;

  abstract listEntries(): Promise<CacheEntryMeta[]>;
}
