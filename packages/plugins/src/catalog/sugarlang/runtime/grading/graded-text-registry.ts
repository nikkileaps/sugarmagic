/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/graded-text-registry.ts
 *
 * Purpose: Holds the registered source strategies and collects gradable units
 * across all of them.
 *
 * Exports:
 *   - GradedTextSourceRegistry
 *   - createDefaultGradedTextSourceRegistry
 *
 * Relationships:
 *   - Depends on ./graded-text-source contracts and ./sources/* strategies.
 *   - Consumed by the compile scheduler (grade everything in a corpus) and by
 *     Studio surfaces (grade one selected thing).
 *
 * Implements: Epic 086 Story 086.3 (generalised 2026-07-28)
 *
 * Status: active
 *
 * WHY A REGISTRY AND NOT A SWITCH
 *
 * A `switch (kind)` inside the scheduler would work for two kinds and rot at
 * five: every caller that wanted "grade everything" would grow its own copy of
 * the same switch, and they would drift. The registry gives ONE place that
 * knows the full set, so `collectAll` stays correct as kinds are added and the
 * scheduler never names a content kind at all.
 *
 * It is a plain instance, not a module-level singleton, so tests build one with
 * a single strategy and no global state leaks between them.
 */

import type {
  GradedTextCorpus,
  GradedTextSourceKind,
  GradedTextSourceStrategy,
  GradedTextUnit
} from "./graded-text-source";
import { createDialogueNodeSource } from "./sources/dialogue-node-source";
import { createItemViewSource } from "./sources/item-view-source";

export class GradedTextSourceRegistry {
  private readonly strategies = new Map<
    GradedTextSourceKind,
    GradedTextSourceStrategy
  >();

  register(strategy: GradedTextSourceStrategy): this {
    if (this.strategies.has(strategy.kind)) {
      // Silent replacement would make double-registration invisible until a
      // unit went missing from a bake, which is a miserable thing to debug.
      throw new Error(
        `Graded text source "${strategy.kind}" is already registered.`
      );
    }
    this.strategies.set(strategy.kind, strategy);
    return this;
  }

  get(kind: GradedTextSourceKind): GradedTextSourceStrategy | undefined {
    return this.strategies.get(kind);
  }

  list(): GradedTextSourceStrategy[] {
    return [...this.strategies.values()];
  }

  /**
   * Every gradable unit in the corpus, across every registered kind.
   *
   * Sorted by source key so a bake run is deterministic -- two runs over the
   * same corpus queue work in the same order, which keeps telemetry and any
   * partial-progress reporting comparable between runs.
   */
  collectAll(corpus: GradedTextCorpus): GradedTextUnit[] {
    const units: GradedTextUnit[] = [];
    for (const strategy of this.strategies.values()) {
      units.push(...strategy.collect(corpus));
    }
    return units.sort((left, right) =>
      left.contentHash < right.contentHash ? -1 : left.contentHash > right.contentHash ? 1 : 0
    );
  }
}

/** The registry every production caller should use. */
export function createDefaultGradedTextSourceRegistry(): GradedTextSourceRegistry {
  return new GradedTextSourceRegistry()
    .register(createDialogueNodeSource())
    .register(createItemViewSource());
}
