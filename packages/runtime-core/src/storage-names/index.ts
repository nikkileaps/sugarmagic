/**
 * packages/runtime-core/src/storage-names/index.ts
 *
 * Purpose: Names every database and storage key the GAME creates on a
 *   player's device.
 *
 * THE PLAYER INSTALLED A GAME, NOT A TOOLCHAIN
 *   Storage on someone else's machine carries the name of the thing they
 *   chose to play. The tool that built it is not their concern and does not
 *   belong on their disk. So these names lead with the game id -- `wordlark`,
 *   not the name of the editor it was made in.
 *
 *   Studio's OWN storage is the opposite case and is not built here: the
 *   author really is using the editor, so its databases are named for it.
 *
 * WITHOUT THE GAME ID, TWO GAMES SHARE ONE DATABASE
 *   A published game is isolated by its origin, so it cannot collide. Studio
 *   Preview is not: it serves every project from one origin, so two projects
 *   whose stores are named the same way read and write each other's rows.
 *   That is silent, and it looks like corruption rather than a naming bug.
 *
 * ONE PLACE BUILDS THESE NAMES
 *   Every store used to compose its own, which is how several of them ended up
 *   with no game in the name at all and nobody noticed. A single function is
 *   the only way the rule holds for the next store somebody adds.
 *
 * Exports:
 *   - registerActiveGameId, getActiveGameId
 *   - gameScopedStorageName
 *
 * Implements: Plan 092 story 092.6
 *
 * Status: active
 */

let activeGameId: string | null = null;

/**
 * Called by the runtime host at boot, from the game id the build stamped into
 * the boot payload. Pass null to clear (teardown, tests).
 */
export function registerActiveGameId(gameId: string | null): void {
  activeGameId = gameId && gameId.length > 0 ? gameId : null;
}

/**
 * The game currently running, or null before boot has settled.
 *
 * Read per call rather than captured: plugin runtimes are constructed before
 * the host has read the boot payload, the same late-binding reason the
 * access-token registry exists.
 */
export function getActiveGameId(): string | null {
  return activeGameId;
}

/**
 * Builds a storage name for the running game.
 *
 * THROWS WITHOUT A GAME ID, deliberately. Unlike a signed-in account -- which
 * a player legitimately may not have yet -- the game id comes from the build
 * and is present in every correct one. Reaching here without it means the boot
 * payload is wrong, and the alternative to failing is a database shared with
 * whatever else is on this origin.
 */
export function gameScopedStorageName(...parts: readonly string[]): string {
  const gameId = getActiveGameId();
  if (!gameId) {
    throw new Error(
      `[storage-names] cannot name storage for ${parts.join(":") || "(unnamed)"} ` +
        "before the game id is known. The host registers it at boot from the " +
        "boot payload; a build that omits it would have every game on this " +
        "origin sharing one database."
    );
  }
  return [gameId, ...parts.filter((part) => part.length > 0)].join(":");
}
