/**
 * packages/plugins/src/catalog/sugarlang/runtime/scheduler/comprehension-rate.ts
 *
 * Purpose: Pure utility for estimating the learner's predicted comprehension rate
 *   for a scene, and the constants that govern comprehension-rate-based packing.
 *
 * "Comprehension rate" = fraction of scene lemmas the learner currently knows
 * (retrievability >= KNOWN_RETRIEVABILITY_THRESHOLD). This is the outer-loop
 * analogue of the i+1 hypothesis: keep comprehensible input near TARGET_COMPREHENSION_RATE
 * while spending debt-service and new introductions as the budget allows.
 *
 * Exports:
 *   - KNOWN_RETRIEVABILITY_THRESHOLD
 *   - TARGET_COMPREHENSION_RATE
 *   - STRETCH_COMPREHENSION_FLOOR
 *   - estimateSceneComprehensionRate
 *
 * Relationships:
 *   - Consumed by OuterLoopScheduler (outer-loop-scheduler.ts) to determine
 *     whether stretch allowance conditions are met.
 *   - Consumed by the context middleware post-processing step (function-to-chunks
 *     realization cap).
 *
 * Implements: Plan 087 story 087.3
 *
 * Status: active
 */

import type { LemmaCard } from "../types";

/** Retrievability at or above this value = the lemma is "known" for comprehension purposes. */
export const KNOWN_RETRIEVABILITY_THRESHOLD = 0.70;

/**
 * Target comprehension rate for the upcoming scene.
 * The scheduler packs teachables to keep predicted comprehension at or above this floor.
 * At 0.65, roughly two-thirds of scene vocabulary is known -- enough for game-context
 * comprehension. Items below the target are serviced via debt/FSRS before introducing more.
 */
export const TARGET_COMPREHENSION_RATE = 0.65;

/**
 * Comprehension rate at or above this floor = "unusually good opportunity" for stretch.
 * When the learner knows >= 80% of the scene vocabulary, the scheduler deliberately
 * picks one slightly-above-level item (STRETCH_ALLOWANCE gate).
 */
export const STRETCH_COMPREHENSION_FLOOR = 0.80;

/**
 * Estimate the fraction of scene lemmas the learner currently knows.
 *
 * Returns 1.0 when sceneLemmaIds is empty (no scene data = assume full comprehension,
 * preserving today's scheduling behavior).
 *
 * Returns null when the scene has no non-chunk lemmas (same rationale: degrade safely).
 */
export function estimateSceneComprehensionRate(
  lemmaCards: Record<string, LemmaCard>,
  sceneLemmaIds: string[]
): number {
  if (sceneLemmaIds.length === 0) return 1.0;
  const known = sceneLemmaIds.filter(
    (id) => (lemmaCards[id]?.retrievability ?? 0) >= KNOWN_RETRIEVABILITY_THRESHOLD
  ).length;
  return known / sceneLemmaIds.length;
}
