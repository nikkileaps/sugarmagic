/**
 * targets/web/src/save/sceneEntry.ts
 *
 * Purpose: Plan 059 §059.3 — the sessionStorage handshake that
 * tells the NEXT boot "the player is entering a Scene fresh, play
 * the entry title sequence (game title -> Scene title)". Set by
 * the Scene-advance reload (alongside the fresh-start flag) and,
 * later, by the Episodes menu's play action (Plan 059 §059.4).
 *
 * The resume rule depends on this marker's ABSENCE: a plain
 * Continue / hard refresh boots without it and goes straight to
 * gameplay — titles never replay mid-Scene (Netflix doesn't
 * re-run the title when you resume an episode).
 *
 * Status: active
 */

export const SCENE_ENTRY_SESSION_STORAGE_KEY = "sugarmagic.scene-entry";

export function markSceneEntryForNextBoot(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SCENE_ENTRY_SESSION_STORAGE_KEY, "1");
}

export function consumeSceneEntryFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const present =
    sessionStorage.getItem(SCENE_ENTRY_SESSION_STORAGE_KEY) === "1";
  if (present) sessionStorage.removeItem(SCENE_ENTRY_SESSION_STORAGE_KEY);
  return present;
}

/**
 * Plan 059 §059.4 — "Back to Episodes" after the final Scene's
 * credits: the reload lands on the start menu with the Episodes
 * screen auto-opened.
 */
export const OPEN_EPISODES_SESSION_STORAGE_KEY = "sugarmagic.open-episodes";

export function markOpenEpisodesForNextBoot(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(OPEN_EPISODES_SESSION_STORAGE_KEY, "1");
}

export function consumeOpenEpisodesFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const present =
    sessionStorage.getItem(OPEN_EPISODES_SESSION_STORAGE_KEY) === "1";
  if (present) sessionStorage.removeItem(OPEN_EPISODES_SESSION_STORAGE_KEY);
  return present;
}
