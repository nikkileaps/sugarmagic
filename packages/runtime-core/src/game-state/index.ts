/**
 * packages/runtime-core/src/game-state/index.ts
 *
 * Plan 054 — the canonical Model layer for the game's
 * lifecycle. Separate from `UIStateStore` (presentation) along
 * the domain/presentation seam, mirroring how Unreal / Unity /
 * Godot all split game-state from UI-state. The answer to "is
 * the game in progress?" lives in one explicit `lifecycle`
 * field instead of being derived from menu state.
 *
 * Status: active
 */

import { createRuntimeStore, type RuntimeStore } from "../ui-state";

/**
 * Discriminated lifecycle states for the game. One field is the
 * canonical answer to "what phase of the game is the player
 * in?"; menus / pause flags / etc. are downstream derivations.
 *
 * `"game-over"` is parked for v1. Add when wordlark has a
 * death/end UI flow that needs distinguishing from `"paused"`.
 */
export type GameLifecycle =
  | "booting"
  | "start-menu"
  | "playing"
  | "paused";

export interface GameStateSnapshot {
  lifecycle: GameLifecycle;
}

export type GameStateStore = RuntimeStore<GameStateSnapshot>;

/**
 * Constructs a store with the default initial state
 * (`lifecycle: "booting"`). The store is
 * useSyncExternalStore-compatible — pass `store.subscribe` and
 * `store.getState` directly to React's hook.
 */
export function createGameStateStore(
  initial: Partial<GameStateSnapshot> = {}
): GameStateStore {
  return createRuntimeStore<GameStateSnapshot>({
    lifecycle: initial.lifecycle ?? "booting"
  });
}

/**
 * Selector: "is the game actively running gameplay?"
 */
export function isGameInProgress(snapshot: GameStateSnapshot): boolean {
  return snapshot.lifecycle === "playing";
}

/**
 * Selector: "is the game paused?" Returns true for every
 * lifecycle EXCEPT `"playing"` — start-menu and booting are
 * "not running", same as paused from the perspective of input
 * gating and gameplay tick suspension.
 */
export function isGamePaused(snapshot: GameStateSnapshot): boolean {
  return snapshot.lifecycle !== "playing";
}

/**
 * The transition methods the host owns, defined here in
 * runtime-core so ui-actions can call them without depending on
 * target-web.
 *
 * Target-web's `WebRuntimeHost` implements this interface
 * (`host.startNewGame` / `host.continueGame` / ...). The host
 * passes the methods bound to a `transitions` object when
 * registering default ui-actions; ui-action handlers call them
 * instead of mutating UIStateStore directly.
 */
export interface GameLifecycleTransitions {
  /** Destructive: resets the save and reloads the page. */
  startNewGame(): Promise<void> | void;
  /** Transitions to "playing" from the start menu (save was
   *  loaded at boot). */
  continueGame(): void;
  /** "playing" -> "paused". Warns on illegal source state. */
  pauseGame(): void;
  /** "paused" -> "playing". Warns on illegal source state. */
  resumeGame(): void;
  /** "playing" | "paused" -> "start-menu". Save untouched. */
  quitToMenu(): void;
}
