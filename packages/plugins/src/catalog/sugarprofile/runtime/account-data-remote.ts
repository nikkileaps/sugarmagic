/**
 * packages/plugins/src/catalog/sugarprofile/runtime/account-data-remote.ts
 *
 * Purpose: The Supabase side of per-account record storage — the backend that
 *   `runtime-core/src/account-data` syncs against.
 *
 * WHY THE IMPLEMENTATION LIVES HERE AND THE INTERFACE DOES NOT
 *   Same split as the save store: runtime-core declares what a backend must
 *   do, and the plugin that owns accounts supplies one. Core therefore never
 *   learns which backend a project uses, and a project with this plugin
 *   uninstalled still gets working local storage that simply never leaves the
 *   device.
 *
 * ONE TABLE FOR EVERY PLUGIN
 *   `plugin_id` and `store_id` are columns, so a new plugin needing synced
 *   storage needs no migration and no code here. Row-level security scopes
 *   every row to its owner, so a plugin cannot reach another account's records
 *   even by asking for them.
 *
 * THE DATABASE STAMPS THE TIME
 *   `updated_at` is set by a trigger and is what last-write-wins compares.
 *   Whatever the client sends is ignored -- client clocks disagree, and a
 *   device with a wrong one would win every conflict it took part in.
 *
 * Exports:
 *   - createSupabaseAccountDataRemote
 *
 * Implements: Plan 092 story 092.6.3
 *
 * Status: active
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountDataRemote,
  AccountStoreKey,
  RemoteAccountRecord,
  RemotePushResult
} from "@sugarmagic/runtime-core";

const TABLE = "account_records";

interface AccountRecordRow {
  record_key: string;
  data: unknown | null;
  schema_version: number;
  deleted: boolean;
  updated_at: string;
}

function rowToRecord(row: AccountRecordRow): RemoteAccountRecord {
  return {
    key: row.record_key,
    data: row.data,
    schemaVersion: row.schema_version,
    deleted: row.deleted,
    updatedAt: row.updated_at
  };
}

export function createSupabaseAccountDataRemote(
  client: SupabaseClient
): AccountDataRemote {
  return {
    async pull(
      key: AccountStoreKey,
      since: string | null,
      limit: number
    ): Promise<{ records: RemoteAccountRecord[]; nextSince: string | null }> {
      let query = client
        .from(TABLE)
        .select("record_key, data, schema_version, deleted, updated_at")
        .eq("user_id", key.userId)
        .eq("plugin_id", key.pluginId)
        .eq("store_id", key.storeId)
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (since) {
        query = query.gt("updated_at", since);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`[sugarprofile] account-data pull failed: ${error.message}`);
      }
      const rows = (data ?? []) as AccountRecordRow[];
      const records = rows.map(rowToRecord);
      return {
        records,
        // Only advance when the page was full. A short page is the end, and
        // advancing past it would skip records that share the last timestamp.
        nextSince:
          rows.length === limit ? (rows[rows.length - 1]?.updated_at ?? null) : null
      };
    },

    async push(
      key: AccountStoreKey,
      records: ReadonlyArray<RemoteAccountRecord>
    ): Promise<RemotePushResult> {
      if (records.length === 0) return { accepted: [] };

      const { data, error } = await client
        .from(TABLE)
        .upsert(
          records.map((record) => ({
            user_id: key.userId,
            plugin_id: key.pluginId,
            store_id: key.storeId,
            record_key: record.key,
            data: record.data,
            schema_version: record.schemaVersion,
            deleted: record.deleted
            // updated_at deliberately absent -- the trigger owns it.
          })),
          { onConflict: "user_id,plugin_id,store_id,record_key" }
        )
        .select("record_key, updated_at");

      if (error) {
        throw new Error(`[sugarprofile] account-data push failed: ${error.message}`);
      }
      // The caller records these against each local record, so it must be the
      // timestamp the database actually wrote, not one guessed here.
      return {
        accepted: ((data ?? []) as Array<{ record_key: string; updated_at: string }>).map(
          (row) => ({ key: row.record_key, updatedAt: row.updated_at })
        )
      };
    }
  };
}
