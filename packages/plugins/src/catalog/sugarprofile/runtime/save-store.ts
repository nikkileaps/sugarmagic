/**
 * packages/plugins/src/catalog/sugarprofile/runtime/save-store.ts
 *
 * Purpose: Supabase Postgres implementation of `GameSaveStore`.
 * Reads + writes `public.saves` via the supplied authenticated
 * Supabase client; RLS gates every query to `auth.uid() = user_id`
 * server-side (defense in depth — the client also asserts userId
 * matches before returning a row).
 *
 * Implements: Plan 047 §Story 47.8
 *
 * Status: active
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GAME_SAVE_SCHEMA_VERSION,
  type GameSave,
  type GameSaveStore
} from "@sugarmagic/runtime-core";

export interface SupabaseGameSaveStoreOptions {
  /** Authenticated Supabase client. Shared with the
   *  SupabaseIdentityProvider so signIn/signOut state flows through
   *  to the same JWT used for RLS-gated reads + writes. */
  client: SupabaseClient;
}

interface PersistedRow {
  user_id: string;
  last_played: string;
  schema_version: number;
  payload: GameSave["payload"];
}

function rowToGameSave(row: PersistedRow): GameSave {
  return {
    userId: row.user_id,
    lastPlayed: row.last_played,
    schemaVersion: row.schema_version,
    payload: row.payload
  };
}

/**
 * Creates a Supabase-backed `GameSaveStore`. The client must be
 * authenticated (real or anonymous Supabase user) — RLS policies on
 * `public.saves` require `auth.uid() = user_id` for every
 * operation, so an unauthenticated client gets 0 rows on `load` and
 * permission errors on `save` / `clear`.
 *
 * Stamps `last_played` server-side via `now()`; callers don't need
 * to pass a timestamp.
 */
export function createSupabaseGameSaveStore(
  options: SupabaseGameSaveStoreOptions
): GameSaveStore {
  const { client } = options;

  return {
    async load(userId): Promise<GameSave | null> {
      if (!userId) {
        throw new Error("[sugarprofile] save-store load() requires a non-empty userId.");
      }
      const { data, error } = await client
        .from("saves")
        .select("user_id, last_played, schema_version, payload")
        .eq("user_id", userId)
        .maybeSingle<PersistedRow>();
      if (error) {
        throw new Error(
          `[sugarprofile] save-store load failed: ${error.message}`
        );
      }
      if (!data) return null;
      if (data.user_id !== userId) {
        throw new Error(
          `[sugarprofile] save-store returned a row whose user_id "${data.user_id}" disagrees with the requested userId "${userId}". RLS should have prevented this; refusing to return cross-user state.`
        );
      }
      return rowToGameSave(data);
    },

    async save(userId, gameSave): Promise<void> {
      if (!userId) {
        throw new Error("[sugarprofile] save-store save() requires a non-empty userId.");
      }
      if (gameSave.userId !== userId) {
        throw new Error(
          `[sugarprofile] save-store save() called with userId="${userId}" but GameSave carries userId="${gameSave.userId}". Refusing to write cross-user state.`
        );
      }
      const { error } = await client.from("saves").upsert(
        {
          user_id: userId,
          last_played: new Date().toISOString(),
          schema_version: GAME_SAVE_SCHEMA_VERSION,
          payload: gameSave.payload
        },
        { onConflict: "user_id" }
      );
      if (error) {
        throw new Error(
          `[sugarprofile] save-store save failed: ${error.message}`
        );
      }
    },

    async clear(userId): Promise<void> {
      if (!userId) {
        throw new Error("[sugarprofile] save-store clear() requires a non-empty userId.");
      }
      const { error } = await client
        .from("saves")
        .delete()
        .eq("user_id", userId);
      if (error) {
        throw new Error(
          `[sugarprofile] save-store clear failed: ${error.message}`
        );
      }
    }
  };
}
