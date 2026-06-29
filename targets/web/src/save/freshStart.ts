/**
 * targets/web/src/save/freshStart.ts
 *
 * Purpose: One implementation of the "New Game -> reload"
 * handshake shared by every target that hosts WebRuntimeHost
 * (target-web's App.tsx, the studio's preview). Owns the
 * single sessionStorage key, the reset-and-reload sequence, and
 * the boot-time consumption of the flag.
 *
 * Status: active
 */

import type { WebRuntimeHost } from "../runtimeHost";

/**
 * Single source of truth for the sessionStorage key that
 * survives a `window.location.reload()` from a New Game click
 * to the next boot. sessionStorage clears on tab close, so a
 * stale flag never leaks to a future session.
 */
export const FRESH_START_SESSION_STORAGE_KEY = "sugarmagic.fresh-start";

/**
 * Called at module load. Reads the fresh-start flag set by a
 * prior `resetSaveAndReload` call and removes it so the next
 * boot doesn't see it. Returns `true` when this boot was
 * triggered by New Game (so callers can skip the start menu
 * and drop the player straight into gameplay).
 */
export function consumeFreshStartFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const present =
    sessionStorage.getItem(FRESH_START_SESSION_STORAGE_KEY) === "1";
  if (present) sessionStorage.removeItem(FRESH_START_SESSION_STORAGE_KEY);
  return present;
}

/**
 * The structural reset flow used by `onStartNewGame`. Reads
 * the active providers from the host's observable snapshot
 * (NOT from React state — see the closure trap discussion in
 * `feedback_stale_closure_react_state` memory), runs the
 * store's `resetForNewGame` to atomically clear + freeze, sets
 * the fresh-start flag, and reloads. The serialized-store
 * wrapper guarantees no autosave write can race past the
 * delete; this helper just sequences the side effects around it.
 *
 * Safe to call when providers haven't resolved yet — the
 * reload happens unconditionally so the player isn't stuck on
 * the menu.
 */
export async function resetSaveAndReload(
  host: WebRuntimeHost,
  logTag: string
): Promise<void> {
  const bindings = host.state.activeProviders.getSnapshot();
  const settledUser = bindings?.identityProvider.currentUser();
  if (bindings && settledUser) {
    try {
      await bindings.saveStore.resetForNewGame(settledUser.userId);
    } catch (error) {
      // resetForNewGame leaves the store frozen on failure, so
      // no autosave can re-corrupt. Reloading still recovers:
      // the next page load constructs a fresh store.
      console.warn(
        `[${logTag}] start-new-game: resetForNewGame failed; store is frozen, reload below rebuilds from scratch.`,
        error
      );
    }
  } else {
    // Providers hadn't resolved yet OR the active identity has
    // no current user — extremely rare in practice (the menu
    // is only reachable after gameplay starts, which requires
    // resolution). Reload anyway; boot will start fresh.
    console.warn(
      `[${logTag}] start-new-game: no active providers/user at click time; reloading anyway.`
    );
  }
  sessionStorage.setItem(FRESH_START_SESSION_STORAGE_KEY, "1");
  window.location.reload();
}
