/**
 * packages/plugins/src/catalog/sugaragent/runtime/lore-relevance.ts
 *
 * Purpose: the bounds and shipped default for `loreRelevanceFloor`, the
 * project's minimum similarity score for a lore search result.
 *
 * Nothing in the game filters by score. The value is sent with every
 * search as `scoreThreshold` and the vector store applies it, so a
 * result below it is never returned at all.
 *
 * Status: active
 */

/**
 * Shipped default. Matches the gateway's own fallback for a request
 * that omits `scoreThreshold` (deployment/gateway/core.ts), so a project
 * that never touches the setting behaves the same either way. Keep the
 * two in step: they live on opposite sides of an HTTP call and cannot
 * share a constant.
 */
export const DEFAULT_LORE_RELEVANCE_FLOOR = 0.3;

/** Lowest and highest threshold a project may configure. */
export const MIN_LORE_RELEVANCE_FLOOR = 0;
export const MAX_LORE_RELEVANCE_FLOOR = 1;
