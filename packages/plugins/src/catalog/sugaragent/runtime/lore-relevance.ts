/**
 * packages/plugins/src/catalog/sugaragent/runtime/lore-relevance.ts
 *
 * Purpose: the one place that decides whether a retrieved lore chunk is
 * relevant enough to use. Every caller that reads lore search results
 * filters them here -- RetrieveStage for per-turn evidence, the
 * quest-context middleware for the world-context block.
 *
 * The floor value itself is the `loreRelevanceFloor` config value, set
 * per project in the sugaragent settings. This module owns its shipped
 * default.
 *
 * Status: active
 */

/**
 * Shipped default for `loreRelevanceFloor`. 0 turns the floor off:
 * every result is kept. Scores are corpus-dependent, so a project sets
 * its own value after reading real scores from the
 * `__sugaragentRetrieval` / `__sugaragentQuestContext` debug handles.
 */
export const DEFAULT_LORE_RELEVANCE_FLOOR = 0;

/** Lowest and highest floor a project may configure. */
export const MIN_LORE_RELEVANCE_FLOOR = 0;
export const MAX_LORE_RELEVANCE_FLOOR = 1;

export interface RelevanceFloorResult<TItem> {
  /** Items that met the floor, in their original order. */
  kept: TItem[];
  /** The score of every item that did not, for diagnostics. */
  droppedScores: number[];
}

/**
 * Split lore search results into the ones that meet the floor and the
 * scores of the ones that do not. A floor of 0 (or anything not above
 * 0) means the floor is off and everything is kept.
 */
export function applyRelevanceFloor<TItem extends { score: number }>(
  items: readonly TItem[],
  floor: number
): RelevanceFloorResult<TItem> {
  if (!Number.isFinite(floor) || floor <= 0) {
    return { kept: [...items], droppedScores: [] };
  }
  const kept: TItem[] = [];
  const droppedScores: number[] = [];
  for (const item of items) {
    if (item.score >= floor) {
      kept.push(item);
    } else {
      droppedScores.push(item.score);
    }
  }
  return { kept, droppedScores };
}
