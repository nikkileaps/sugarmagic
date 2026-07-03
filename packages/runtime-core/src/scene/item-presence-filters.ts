/**
 * packages/runtime-core/src/scene/item-presence-filters.ts
 *
 * Purpose: Shared filter helper for item-presence iteration.
 * The visual mesh spawn (in `targets/web/src/runtimeHost.ts`)
 * and the ECS `Interactable` spawn (in
 * `packages/runtime-core/src/coordination/gameplay-session.ts`)
 * both iterate `region.scene.itemPresences` to decide which
 * item entities land in the world at region load. Before this
 * module, each spawn path had its own inline filter check, and
 * we shipped a bug (Plan 055.6) where a new filter was added to
 * one path and forgotten in the other.
 *
 * Implements: Plan 057
 *
 * Status: active
 */

import type { RegionItemPresence } from "@sugarmagic/domain";

/**
 * The filter surface both spawn paths consult. Single
 * `shouldSkip` predicate today; when a second filter arrives
 * (Plan 058 Scene gating), it composes into this predicate at
 * a single call site (the filters object the host constructs).
 * Callers stay unchanged.
 */
export interface ItemPresenceFilters {
  /** Returns true when the caller should skip spawning this
   *  presence in the current region (already collected, future
   *  Scene locked, etc.). */
  shouldSkip: (presenceId: string) => boolean;
}

/**
 * Iterate `presences` applying `filters`, invoking `onEach` for
 * every presence that survives. Allocation-free; callers that
 * want an array can push into one inside `onEach`.
 *
 * Semantic invariant: both the visual spawner and the ECS
 * spawner MUST use this helper with a filters object of
 * identical shape. Sharing the shape (not the object literal
 * itself) is what closes Plan 057's risk.
 */
export function iterateActiveItemPresences(
  presences: readonly RegionItemPresence[],
  filters: ItemPresenceFilters,
  onEach: (presence: RegionItemPresence) => void
): void {
  for (const presence of presences) {
    if (filters.shouldSkip(presence.presenceId)) continue;
    onEach(presence);
  }
}
