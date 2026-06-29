/**
 * packages/runtime-core/src/game-state/index.ts
 *
 * Plan 054 §054.2 — the canonical Model layer for the game's
 * lifecycle. Separate from `UIStateStore` (presentation) so the
 * answer to "is the game in progress?" lives in one explicit
 * field instead of being derived from menu state.
 *
 * Why split out of `UIStateStore`: the original store mixed
 * domain (`visibleMenuKey === "start-menu"` / `isPaused` /
 * `savePresent`) with presentation (`loginModalOpen`). The
 * menu-driven framing inverted the right direction of data flow
 * (the menu reflected lifecycle, but lifecycle was derived from
 * the menu — see Plan 054 problem statement). Splitting along
 * the domain/presentation seam lines up with how Unreal /
 * Unity / Godot all do it (separate state machines for game
 * lifecycle vs UI).
 *
 * Migration: 054.2 introduces this store alongside the existing
 * `UIStateStore`. 054.3 wires both onto `WebRuntimeHost.state`
 * and adds the coordinating bridge so legacy `setState` calls
 * on `UIStateStore.{visibleMenuKey, isPaused}` ALSO update
 * `GameStateStore.lifecycle` during the migration window. 054.4
 * migrates writers + readers per the 054.1 audit. Once the
 * legacy fields have no consumers, `UIStateStore` slims to
 * presentation-only and `GameStateStore` owns lifecycle outright.
 *
 * Status: active
 */

import { createRuntimeStore, type RuntimeStore } from "../ui-context";

/**
 * Discriminated lifecycle states for the game. One field is the
 * canonical answer to "what phase of the game is the player
 * in?"; menus / pause flags / etc. are downstream derivations.
 */
export type GameLifecycle =
  | "booting"
  | "start-menu"
  | "playing"
  | "paused";
// "game-over" is parked for v1. Add when wordlark has a
// death/end UI flow that needs distinguishing from "paused".

/**
 * The game's domain state, as observed by every system that
 * cares about "what's going on right now." `savePresent` is
 * domain data (does the user have a save?), kept here so the
 * start menu's Continue button can render conditionally without
 * coupling to UI state.
 */
export interface GameStateSnapshot {
  lifecycle: GameLifecycle;
  savePresent: boolean;
}

export type GameStateStore = RuntimeStore<GameStateSnapshot>;

/**
 * Constructs a store with the default initial state
 * (`lifecycle: "booting"`, `savePresent: false`). Callers can
 * override either field via `initial`. The store is
 * useSyncExternalStore-compatible — pass `store.subscribe` and
 * `store.getState` directly to React's hook.
 */
export function createGameStateStore(
  initial: Partial<GameStateSnapshot> = {}
): GameStateStore {
  return createRuntimeStore<GameStateSnapshot>({
    lifecycle: initial.lifecycle ?? "booting",
    savePresent: initial.savePresent ?? false
  });
}

/**
 * Selector: "is the game actively running gameplay?" Use this
 * in callsites that previously read `!state.isPaused && state.visibleMenuKey === null` (or equivalent).
 */
export function isGameInProgress(snapshot: GameStateSnapshot): boolean {
  return snapshot.lifecycle === "playing";
}

/**
 * Selector: "is the game paused?" Use this in callsites that
 * previously read `state.isPaused`. Returns true for every
 * lifecycle EXCEPT "playing" — the start menu and booting
 * states are "not running", same as paused, from the
 * perspective of input gating and gameplay tick suspension.
 */
export function isGamePaused(snapshot: GameStateSnapshot): boolean {
  return snapshot.lifecycle !== "playing";
}
