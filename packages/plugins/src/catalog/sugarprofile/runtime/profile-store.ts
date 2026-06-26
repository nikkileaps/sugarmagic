/**
 * packages/plugins/src/catalog/sugarprofile/runtime/profile-store.ts
 *
 * Purpose: Supabase Postgres implementation of `UserProfileStore`.
 * Reads + writes `public.profiles` via the supplied authenticated
 * Supabase client; RLS gates every query to `auth.uid() = user_id`.
 * The `setPreference` helper handles the load-merge-update dance so
 * callers don't clobber sibling preference keys.
 *
 * The auto-create trigger SugarProfile's migration installs on
 * `auth.users` INSERT means a profile row exists for every
 * authenticated user — `load()` should rarely return null in
 * practice, but the contract allows it for the pre-trigger /
 * pre-migration window.
 *
 * Implements: Plan 047 §Story 47.8
 *
 * Status: active
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UserProfile,
  UserProfilePatch,
  UserProfileStore
} from "@sugarmagic/runtime-core";

export interface SupabaseProfileStoreOptions {
  client: SupabaseClient;
}

interface PersistedRow {
  user_id: string;
  display_name: string | null;
  locale: string;
  preferences: Record<string, unknown> | null;
  updated_at: string;
}

function rowToProfile(row: PersistedRow): UserProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    locale: row.locale,
    preferences: row.preferences ?? {},
    updatedAt: row.updated_at
  };
}

export function createSupabaseProfileStore(
  options: SupabaseProfileStoreOptions
): UserProfileStore {
  const { client } = options;

  async function readRow(userId: string): Promise<PersistedRow | null> {
    const { data, error } = await client
      .from("profiles")
      .select("user_id, display_name, locale, preferences, updated_at")
      .eq("user_id", userId)
      .maybeSingle<PersistedRow>();
    if (error) {
      throw new Error(
        `[sugarprofile] profile-store load failed: ${error.message}`
      );
    }
    return data ?? null;
  }

  return {
    async load(userId): Promise<UserProfile | null> {
      if (!userId) {
        throw new Error(
          "[sugarprofile] profile-store load() requires a non-empty userId."
        );
      }
      const row = await readRow(userId);
      return row ? rowToProfile(row) : null;
    },

    async update(userId, patch: UserProfilePatch): Promise<UserProfile> {
      if (!userId) {
        throw new Error(
          "[sugarprofile] profile-store update() requires a non-empty userId."
        );
      }
      const upsertRow: Record<string, unknown> = {
        user_id: userId,
        updated_at: new Date().toISOString()
      };
      if (patch.displayName !== undefined) upsertRow.display_name = patch.displayName;
      if (patch.locale !== undefined) upsertRow.locale = patch.locale;
      if (patch.preferences !== undefined) upsertRow.preferences = patch.preferences;

      const { data, error } = await client
        .from("profiles")
        .upsert(upsertRow, { onConflict: "user_id" })
        .select("user_id, display_name, locale, preferences, updated_at")
        .single<PersistedRow>();
      if (error) {
        throw new Error(
          `[sugarprofile] profile-store update failed: ${error.message}`
        );
      }
      if (!data) {
        throw new Error(
          "[sugarprofile] profile-store update returned no row after upsert."
        );
      }
      return rowToProfile(data);
    },

    async setPreference(userId, key, value): Promise<void> {
      if (!userId) {
        throw new Error(
          "[sugarprofile] profile-store setPreference() requires a non-empty userId."
        );
      }
      if (!key) {
        throw new Error(
          "[sugarprofile] profile-store setPreference() requires a non-empty key."
        );
      }
      // Read-merge-write. RLS makes this safe per-user; we accept
      // the round-trip cost because Supabase Postgres doesn't
      // expose jsonb_set via supabase-js without an RPC call, and
      // adding a stored procedure for one operation is overkill.
      const existing = await readRow(userId);
      const mergedPreferences: Record<string, unknown> = {
        ...((existing?.preferences ?? {}) as Record<string, unknown>),
        [key]: value
      };
      const upsertRow = {
        user_id: userId,
        preferences: mergedPreferences,
        updated_at: new Date().toISOString()
      };
      const { error } = await client
        .from("profiles")
        .upsert(upsertRow, { onConflict: "user_id" });
      if (error) {
        throw new Error(
          `[sugarprofile] profile-store setPreference failed: ${error.message}`
        );
      }
    }
  };
}
