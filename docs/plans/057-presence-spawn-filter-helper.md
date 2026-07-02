# Plan 057 — Presence spawn filter helper

Status: proposed
Owner: nikki + claude
Date: 2026-07-02

Related: Runtime paper cut #3 (`docs/backlog/003-runtime-paper-cuts.md`) — the class of bug this closes. Plan 055.6 — the first filter (`world.presence.shouldSkip`) that made the risk concrete. Plan 056 (draft) — future episode gating will add a second filter and would silently break one of the two spawn paths if this isn't unified first.

## Problem

Region items spawn through TWO independent code paths that both iterate `region.scene.itemPresences`:

1. **Visual mesh spawn** — `targets/web/src/runtimeHost.ts:1534` uses `resolveSceneObjects(region)` which internally iterates `itemPresences` and returns a mixed list of visual objects. The host loops and spawns three.js Groups.
2. **ECS Interactable spawn** — `packages/runtime-core/src/coordination/gameplay-session.ts:1029` (`registerItemInteractables`) iterates `activeRegion.scene.itemPresences` directly and creates `Interactable` + `Position` components in the ECS world.

Both loops need to apply the same filters. Currently: one filter (`worldPresenceTracker.shouldSkip` for already-collected items). Applied in both places manually. When Plan 055.6 shipped, the first version added the filter only to path #2, leaving already-collected items still visually spawned (mesh floating with no E prompt). Fixed at the time by adding the same filter to path #1. Two places to remember.

Plan 056's episode-scoped presence gating will add a SECOND filter (per-episode `isPresenceUnlocked`). If we haven't unified by then, we get the same silent-divergence bug twice. This plan pre-empts that.

## Goal

Both spawn paths call THE SAME predicate to decide whether an item presence is "active" in the current region. Adding a filter is a one-file change; both callers automatically pick it up.

## Non-goals

- **Not a full callback pipeline.** The paper cut writeup mentioned a "host-owned iteration with renderer + ECS callbacks." That's architecturally purer but structurally larger — the ECS callback would need access to the assembly's `itemInteractableEntities` map for later `collectItemPresence()` lookups, and current construction order (assembly is built AFTER the visual spawn) doesn't naturally accommodate one host-owned iteration. Revisit if we get 3+ filters or if the callback shape becomes obviously right for another reason.
- **Not NPCs / inspectables.** Only items have a filter surface today (world.presence tracks collected items only). NPCs and inspectables don't get "collected" or episode-gated in the current design. When they do, the same helper pattern extends trivially.

## Shape

New helper in `packages/runtime-core/src/scene/`:

```ts
export interface ItemPresenceFilters {
  /** Any predicate returning true means "skip this presence in
   *  this region right now" (already collected, episode locked,
   *  future proximity culling, etc.). All predicates in the
   *  object are ANDed via short-circuit inside the helper. */
  shouldSkip: (presenceId: string) => boolean;
}

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
```

- **Signature choice**: taking `onEach` instead of returning a filtered array keeps the helper allocation-free and matches the "iteration is the primitive" mental model. Callers that need an array can trivially `push` into one from `onEach`.
- **Filters object shape**: single `shouldSkip` predicate. Future filters compose into the same predicate. This is intentionally the "boring" shape — if we need multiple named filters later (episode, collected, unlock-schedule) we can widen the object without changing callers.

## Callers

- `targets/web/src/runtimeHost.ts` visual mesh spawn — the current per-object loop keeps iterating `resolveSceneObjects(region)` for non-item objects. For items, an initial pass through `iterateActiveItemPresences` produces a `Set<presenceId>` of active items; the main loop skips visual `kind: "item"` objects whose `instanceId` isn't in the set.
- `packages/runtime-core/src/coordination/gameplay-session.ts` `registerItemInteractables` — calls `iterateActiveItemPresences` directly with the ECS create-entity work in the `onEach` callback. Removes the inline `if (shouldSkipItemPresence?.(...)) continue`.

Both call the helper with the SAME filters object shape. The host constructs the filters object once and passes it to both call sites (visual pass directly, ECS pass indirectly via the assembly's `shouldSkipItemPresence` option — which becomes `filters` on the assembly side going forward).

## Tests

- Truth-table unit tests for the helper: filter matches -> skip; filter doesn't match -> onEach called with the presence.
- No behavior change tests needed for the callers — the refactor preserves the exact same semantic (filtered iteration -> spawn), and `world.presence`'s existing tests cover the shouldSkip behavior.

## Verification

After the refactor:
1. Same item pickup + reload + Continue flow (Plan 055.6 verification recipe): item stays gone from world (both mesh and E prompt) after Continue.
2. Non-item scene objects (NPCs, static props) still spawn correctly on region load.
3. `pnpm typecheck` clean, `pnpm --filter @sugarmagic/runtime-core exec vitest run` green.
