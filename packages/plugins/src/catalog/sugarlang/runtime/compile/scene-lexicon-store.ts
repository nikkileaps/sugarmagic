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

import type { SceneVocabularyModel } from "../types";
import type { RuntimeCompileScheduler } from "./compile-scheduler";

export interface SugarlangSceneLexiconStore {
  get: (regionId: string) => SceneVocabularyModel | undefined;
  ensure: (regionId: string) => Promise<SceneVocabularyModel>;
  onInvalidate: (listener: (regionId: string) => void) => () => void;
}

export class DefaultSugarlangSceneLexiconStore
  implements SugarlangSceneLexiconStore
{
  private readonly lexicons = new Map<string, SceneVocabularyModel>();
  private readonly listeners = new Set<(regionId: string) => void>();

  constructor(private readonly scheduler: RuntimeCompileScheduler) {}

  seed(lexicons: SceneVocabularyModel[]): void {
    for (const lexicon of lexicons) {
      this.lexicons.set(lexicon.regionId, lexicon);
    }
  }

  invalidate(regionId: string): void {
    if (this.lexicons.delete(regionId)) {
      for (const listener of this.listeners) {
        listener(regionId);
      }
    }
  }

  get(regionId: string): SceneVocabularyModel | undefined {
    return this.lexicons.get(regionId);
  }

  async ensure(regionId: string): Promise<SceneVocabularyModel> {
    const cached = this.lexicons.get(regionId);
    if (cached) {
      return cached;
    }

    const lexicon = await this.scheduler.ensureScene(regionId);
    this.lexicons.set(regionId, lexicon);
    return lexicon;
  }

  onInvalidate(listener: (regionId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
