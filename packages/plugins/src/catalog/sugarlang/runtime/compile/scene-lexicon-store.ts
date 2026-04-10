/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-lexicon-store.ts
 *
 * Purpose: Provides the single consumer-facing store abstraction for compiled scene lexicons.
 *
 * Exports:
 *   - SugarlangSceneLexiconStore
 *   - DefaultSugarlangSceneLexiconStore
 *
 * Relationships:
 *   - Depends on the compile cache and runtime compile scheduler.
 *   - Is the intended downstream read surface for middleware and budgeter work.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { CompiledSceneLexicon } from "../types";
import { compileSugarlangScene } from "./compile-sugarlang-scene";
import type { RuntimeCompileScheduler } from "./compile-scheduler";

export interface SugarlangSceneLexiconStore {
  get: (sceneId: string) => CompiledSceneLexicon | undefined;
  ensure: (sceneId: string) => Promise<CompiledSceneLexicon>;
  onInvalidate: (listener: (sceneId: string) => void) => () => void;
}

export class DefaultSugarlangSceneLexiconStore
  implements SugarlangSceneLexiconStore
{
  private readonly lexicons = new Map<string, CompiledSceneLexicon>();
  private readonly listeners = new Set<(sceneId: string) => void>();

  constructor(private readonly scheduler: RuntimeCompileScheduler) {}

  seed(lexicons: CompiledSceneLexicon[]): void {
    for (const lexicon of lexicons) {
      this.lexicons.set(lexicon.sceneId, lexicon);
    }
  }

  invalidate(sceneId: string): void {
    if (this.lexicons.delete(sceneId)) {
      for (const listener of this.listeners) {
        listener(sceneId);
      }
    }
  }

  get(sceneId: string): CompiledSceneLexicon | undefined {
    return this.lexicons.get(sceneId);
  }

  async ensure(sceneId: string): Promise<CompiledSceneLexicon> {
    const cached = this.lexicons.get(sceneId);
    if (cached) {
      return cached;
    }

    const lexicon = await this.scheduler.ensureScene(sceneId);
    this.lexicons.set(sceneId, lexicon);
    return lexicon;
  }

  onInvalidate(listener: (sceneId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
