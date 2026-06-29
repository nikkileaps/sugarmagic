/**
 * packages/runtime-core/src/input-modes/runtime-mode.ts
 *
 * Purpose: defines the `RuntimeMode` union — the single value
 * that gates which keyboard actions are allowed to fire at any
 * given moment — and the pure `resolveRuntimeMode` function that
 * derives it from the existing `RuntimeUIState`.
 *
 * Why this exists: before Plan 050, every shortcut handler
 * registered its own `window.addEventListener("keydown")` and
 * decided for itself whether to fire (typically a brittle
 * `event.target instanceof HTMLInputElement` check). Hitting
 * `i` during the game's own Start menu still opened the
 * inventory; SugarProfile's LoginModal collided with in-game
 * shortcuts (Plan 047 §47.7.5 band-aided that with autofocus).
 * Plan 050 makes the "should this action fire?" question
 * answerable by a single function: `resolveRuntimeMode`.
 *
 * Mode is DERIVED, never stored: callers read `RuntimeUIState`
 * (which is already authoritative for menu/pause/login-modal
 * state) and ask the resolver. AGENTS.md "one source of truth"
 * — UIStateStore stays canonical; we don't add a parallel
 * mutable `mode` field that could drift.
 *
 * Status: active (Story 50.1)
 */

import type { GameStateSnapshot } from "../game-state";
import type { RuntimeUIState } from "../ui-context";

/**
 * The full set of input modes runtime-core understands today.
 * Adding a new mode is an additive change: extend the union,
 * extend `resolveRuntimeMode`'s decision tree, and register
 * actions against the new mode in their existing call sites.
 *
 * - "login-modal" — a focus-stealing modal (SugarProfile's
 *   LoginModal today; any future credential-prompt UI) is
 *   mounted over the canvas. Disables every keyboard action so
 *   typing into the modal's input doesn't co-fire game
 *   shortcuts.
 * - "start-menu" — the game's start menu (Continue / New Game)
 *   is visible. In-game shortcuts (inventory, journal, etc.)
 *   are off; only menu navigation should be active.
 * - "dialogue" — an NPC dialogue panel is active. Dialogue
 *   advance + option-pick actions fire; in-game shortcuts
 *   don't.
 * - "paused" — pause menu is up, or the game is otherwise
 *   paused without one of the more-specific modes above.
 *   Only resume / quit actions fire.
 * - "in-game" — gameplay is live. Inventory, journal, document,
 *   spells, pause shortcuts all enabled.
 * - "any" — the sentinel debug-only / always-on actions
 *   register against (e.g. the debug HUD's diagnostic
 *   shortcuts). The resolver never RETURNS "any" — it's a
 *   value actions opt into for "fire regardless of mode."
 *
 * The literal "any" sentinel avoids forcing the registry to
 * special-case `modes: null` or `modes: undefined`; an explicit
 * string is symmetric with the other entries and grep-friendly.
 */
export type RuntimeMode =
  | "login-modal"
  | "start-menu"
  | "dialogue"
  | "paused"
  | "in-game"
  | "any";

/**
 * Subset of menu keys `resolveRuntimeMode` treats as
 * mode-defining. Other menus (inventory, quest journal,
 * document, spell menu) are intentionally NOT here — they're
 * overlays the player opens during gameplay, not state
 * transitions. The game is still "in-game" while the inventory
 * is open; the inventory action just toggles its own visibility.
 *
 * Story 50.5 will wire DialoguePanel to set
 * `visibleMenuKey === "dialogue"` when active; until then, the
 * "dialogue" branch is forward-looking.
 */
// Plan 054 §054.4 Pass C — overlay-only mode mappings.
// "start-menu" and "pause-menu" used to live here but those are
// now game lifecycle states, mapped directly from
// `gameState.lifecycle` in `resolveRuntimeMode`.
const MODE_DEFINING_OVERLAY_KEYS: Readonly<
  Record<string, Exclude<RuntimeMode, "any">>
> = {
  dialogue: "dialogue"
};

/**
 * Pure function: given the current `RuntimeUIState`, return the
 * single active mode. Priority cascade (highest first):
 *
 *   1. `loginModalOpen` — the most overriding state; a modal
 *      stealing focus disables everything else.
 *   2. `visibleMenuKey` — when set to a mode-defining key,
 *      that menu's mode wins. Non-mode-defining menus
 *      (inventory etc.) fall through to "in-game".
 *   3. `isPaused` — generic pause without one of the specific
 *      menus above.
 *   4. default — "in-game".
 *
 * Pure / referentially-transparent / no side effects. Safe to
 * call on every keydown without performance concern; the body
 * is a fixed-cost decision tree.
 */
export function resolveRuntimeMode(
  uiState: RuntimeUIState,
  gameState: GameStateSnapshot = { lifecycle: "playing" }
): Exclude<RuntimeMode, "any"> {
  if (uiState.loginModalOpen) return "login-modal";
  // Lifecycle dominates: start menu / paused / booting all hold
  // gameplay even if an overlay also opened.
  if (gameState.lifecycle === "start-menu") return "start-menu";
  if (gameState.lifecycle === "paused") return "paused";
  if (gameState.lifecycle === "booting") return "paused";
  // While playing, an overlay key may still gate input.
  if (uiState.activeOverlayMenuKey !== null) {
    const mapped =
      MODE_DEFINING_OVERLAY_KEYS[uiState.activeOverlayMenuKey];
    if (mapped !== undefined) return mapped;
  }
  return "in-game";
}
