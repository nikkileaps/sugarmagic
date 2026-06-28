/**
 * targets/web/src/save/migrate-local-to-cloud.ts
 *
 * Purpose: One-shot copy of the local IndexedDB save up to the active
 * cloud save store on the transition from anonymous to credentialed.
 * Without this, a player who plays anonymously, signs in, then closes
 * the tab loses their pre-sign-in progress: the cloud store has no
 * record under the new credentialed userId, and the local store's
 * record is keyed to the prior anonymous userId.
 *
 * Order matters:
 *   1. Read local save under the anonymous userId.
 *   2. Write to cloud under the credentialed userId (re-keyed).
 *   3. Clear local. Only after a confirmed cloud write — if the cloud
 *      write fails we keep the local record so the next attempt has
 *      something to migrate.
 *
 * Implements: Plan 047 §Story 47.10
 *
 * Status: active
 */

import {
  GAME_SAVE_SCHEMA_VERSION,
  type GameSaveStore
} from "@sugarmagic/runtime-core";

export interface MigrateLocalSaveToCloudOptions {
  localStore: GameSaveStore;
  cloudStore: GameSaveStore;
  /** The anonymous userId the local save was keyed on before sign-in. */
  fromUserId: string;
  /** The credentialed userId the cloud save will be keyed on. With
   *  Supabase's `linkAnonymousToCredentials`, the same userId is
   *  preserved across the upgrade — but we accept distinct ids so the
   *  function works for a future provider that does NOT preserve. */
  toUserId: string;
}

export interface MigrateLocalSaveToCloudResult {
  /** True when a local save existed AND was successfully copied to
   *  the cloud store. False on every other outcome (no local save,
   *  cloud write failed, etc.) — caller can use this to drive
   *  telemetry / toast without re-reading either store. */
  migrated: boolean;
  /** Set when an exception was raised during the cloud write. The
   *  local save is intentionally NOT cleared in this case so a retry
   *  on the next sign-in event (or page reload) still has the data
   *  to migrate. */
  error?: unknown;
}

export async function migrateLocalSaveToCloud(
  options: MigrateLocalSaveToCloudOptions
): Promise<MigrateLocalSaveToCloudResult> {
  const { localStore, cloudStore, fromUserId, toUserId } = options;

  let local;
  try {
    local = await localStore.load(fromUserId);
  } catch (error) {
    return { migrated: false, error };
  }
  if (!local) {
    return { migrated: false };
  }

  try {
    await cloudStore.save(toUserId, {
      userId: toUserId,
      lastPlayed: new Date().toISOString(),
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: local.payload
    });
  } catch (error) {
    return { migrated: false, error };
  }

  try {
    await localStore.clear(fromUserId);
  } catch (error) {
    // Cloud write succeeded; the local copy is now redundant but the
    // migration is functionally complete. Log + return success so the
    // sign-in flow doesn't appear to fail to the user.
    console.warn(
      "[migrate-local-to-cloud] cloud write succeeded but local clear failed",
      { fromUserId, error }
    );
  }
  return { migrated: true };
}
