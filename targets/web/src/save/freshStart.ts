/**
 * targets/web/src/save/freshStart.ts
 *
 * Single owner of the sessionStorage handshake that survives a
 * `window.location.reload()` from a New Game click to the next
 * boot. Two pieces:
 *
 *   - `FRESH_START_SESSION_STORAGE_KEY` — the storage key.
 *     Imported by the host's internal `startNewGame` (Plan 054
 *     §054.3) on the write side, and by App.tsx / preview.tsx
 *     module-load on the read side.
 *   - `consumeFreshStartFlag` — read + remove at module load so
 *     the next boot starts clean. Returns `true` when the prior
 *     reload was triggered by New Game (caller passes through
 *     as `skipStartMenuOnBoot`).
 *
 * The "do the reset then reload" sequence used to live here as
 * `resetSaveAndReload`; Plan 054 §054.3 moved it onto
 * `WebRuntimeHost.startNewGame()`, which owns the lifecycle.
 *
 * Plan 058 §058.5 — the Scene-advance reload sets the same flag:
 * despite the "fresh start" name, the flag's actual semantic is
 * "the next boot continues gameplay without the start menu",
 * which holds for both New Game (save wiped pre-reload) and Scene
 * advance (save force-written pre-reload).
 *
 * Status: active
 */

export const FRESH_START_SESSION_STORAGE_KEY = "sugarmagic.fresh-start";

export function consumeFreshStartFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const present =
    sessionStorage.getItem(FRESH_START_SESSION_STORAGE_KEY) === "1";
  if (present) sessionStorage.removeItem(FRESH_START_SESSION_STORAGE_KEY);
  return present;
}
