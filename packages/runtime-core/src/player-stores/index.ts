/**
 * packages/runtime-core/src/player-stores/index.ts
 *
 * Purpose: Knows which stores hold the current player's data, so anything that
 *   needs to clear them can ASK rather than guess.
 *
 * WHY THIS EXISTS
 *   Clearing a player's data used to mean listing every database in the
 *   browser and keeping the ones whose names looked right. That is a guess
 *   dressed as a lookup, and it broke the first time a store was renamed: the
 *   pattern stopped matching, the wipe reported success, and every record it
 *   was supposed to delete stayed exactly where it was.
 *
 *   A store that exists registers itself. Clearing walks the registry. There
 *   is no pattern to keep in sync with anything, and a store added tomorrow is
 *   covered the day it is written rather than the day someone remembers to
 *   update a regular expression.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *   Reach a store nothing has opened -- a language pair the player is not
 *   using, or a previous account on the same browser. Nothing holds those, so
 *   nothing can ask them anything. That is a separate cleanup problem and
 *   should be solved as one, not by making this guess again.
 *
 * Exports:
 *   - registerPlayerStore, unregisterPlayerStore
 *   - listPlayerStores, clearPlayerStoresForPlugin
 *   - PlayerStoreRegistration
 *
 * Implements: Plan 092 story 092.6
 *
 * Status: active
 */

export interface PlayerStoreRegistration {
  /** Which plugin owns it. Data, never something this module knows. */
  pluginId: string;
  /** Distinguishes it from that plugin's other stores. For logs. */
  storeId: string;
  /**
   * Forget everything this store holds for the current player.
   *
   * A store that syncs must make the clear REACH the account -- tombstones,
   * not dropped rows -- or the next reconcile hands it all back.
   */
  clear: () => Promise<void>;
}

const registered = new Map<string, PlayerStoreRegistration>();

const keyOf = (pluginId: string, storeId: string) => `${pluginId}:${storeId}`;

export function registerPlayerStore(entry: PlayerStoreRegistration): void {
  registered.set(keyOf(entry.pluginId, entry.storeId), entry);
}

export function unregisterPlayerStore(pluginId: string, storeId: string): void {
  registered.delete(keyOf(pluginId, storeId));
}

export function listPlayerStores(): PlayerStoreRegistration[] {
  return Array.from(registered.values());
}

export interface ClearPlayerStoresResult {
  cleared: string[];
  failed: Array<{ storeId: string; reason: string }>;
}

/**
 * Clear every registered store belonging to one plugin.
 *
 * One store failing does not stop the rest: a partial wipe is bad, but a wipe
 * that stops at the first problem and says nothing about the remainder is
 * worse. Both lists come back so the caller can report what actually happened
 * rather than claiming success.
 */
export async function clearPlayerStoresForPlugin(
  pluginId: string
): Promise<ClearPlayerStoresResult> {
  const result: ClearPlayerStoresResult = { cleared: [], failed: [] };
  for (const entry of listPlayerStores()) {
    if (entry.pluginId !== pluginId) continue;
    try {
      await entry.clear();
      result.cleared.push(entry.storeId);
    } catch (error) {
      result.failed.push({
        storeId: entry.storeId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return result;
}
