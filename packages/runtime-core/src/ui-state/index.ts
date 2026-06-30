/**
 * packages/runtime-core/src/ui-state/index.ts
 *
 * Plan 054 — the presentation-state store. Carries what's on
 * SCREEN (overlay menu open, login modal open, save-present
 * flag for menu rendering). Domain-level lifecycle lives in
 * `game-state/`; this module is the View/VM side of the MVVM
 * split.
 *
 * Hosts (`WebRuntimeHost.state.uiState`) expose this store
 * alongside `gameState`. React UI subscribes via
 * `useSyncExternalStore(store.subscribe, store.getState)`.
 *
 * Also defines the generic `RuntimeStore<TState>` shape +
 * `createRuntimeStore<TState>` factory that both this module
 * and `game-state` build on. Kept here because the canonical
 * consumer is `createUIStateStore`; `game-state` imports the
 * factory from here.
 *
 * Status: active
 */

export interface RuntimeUIState {
  /**
   * Overlay-menu key. Carries dialogue, future inventory /
   * plugin overlays — NEVER lifecycle menus (`"start-menu"` /
   * `"pause-menu"`); those live on `GameStateStore.lifecycle`.
   */
  activeOverlayMenuKey: string | null;
  /**
   * Story 47.10.5 — whether the active user has a save in the
   * active save store. Drives `visibility: "hasSave" | "noSave"`
   * on menu nodes so the start menu can show a Continue button
   * only when there's something to continue. Host flips it true
   * on autosave write, false on start-new-game's clear.
   */
  savePresent: boolean;
  /**
   * Story 50.1 — true while SugarProfile's LoginModal (or any
   * future focus-stealing modal overlaying the canvas) is
   * mounted. The input-modes resolver consumes this to switch
   * `RuntimeMode` to "login-modal", which disables every other
   * keyboard action so typing into the modal's email input
   * doesn't simultaneously toggle the inventory.
   */
  loginModalOpen: boolean;
}

export interface RuntimeStore<TState> {
  getState(): TState;
  /**
   * Accepts a partial patch (merged onto the current state)
   * OR a full updater function. Partial-patch semantics make
   * adding new fields to the state type back-compatible —
   * callers that only set one field still compile after a new
   * field lands.
   */
  setState(
    next: Partial<TState> | ((current: TState) => TState)
  ): void;
  subscribe(listener: () => void): () => void;
}

/**
 * Shared store factory used by both `createUIStateStore` and
 * `createGameStateStore`. Don't reach for this in application
 * code — use the typed factory for the store you actually
 * need so setState patches stay typed.
 */
export function createRuntimeStore<TState extends object>(
  initialState: TState
): RuntimeStore<TState> {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getState() {
      return state;
    },
    setState(next) {
      state =
        typeof next === "function"
          ? (next as (current: TState) => TState)(state)
          : { ...state, ...next };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export type UIStateStore = RuntimeStore<RuntimeUIState>;

export function createUIStateStore(
  initialState: Partial<RuntimeUIState> = {}
): UIStateStore {
  return createRuntimeStore<RuntimeUIState>({
    activeOverlayMenuKey: initialState.activeOverlayMenuKey ?? null,
    savePresent: initialState.savePresent ?? false,
    loginModalOpen: initialState.loginModalOpen ?? false
  });
}
