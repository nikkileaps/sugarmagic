/**
 * packages/plugins/src/catalog/sugarprofile/runtime/supabase-record-storage.ts
 *
 * Purpose: The Supabase side of per-account storage — the backend that
 *   `runtime-core/src/sync-engine` reconciles against.
 *
 * WHY THE IMPLEMENTATION LIVES HERE AND THE INTERFACE DOES NOT
 *   Same split as the save store: runtime-core declares what a backend must
 *   do, and the plugin that owns accounts supplies one. Core therefore never
 *   learns which backend a project uses, and a project with this plugin
 *   uninstalled still gets working local storage that simply never leaves the
 *   device.
 *
 * IT IS HANDED THE TABLE, IT DOES NOT CHOOSE ONE
 *   Every synced store declares its own table and ships the migration that
 *   creates it, so its records land in real typed columns the database can
 *   index and constrain. This file names no table and no plugin -- it builds
 *   the same four-column query against whatever it is given.
 *
 * THE DATABASE STAMPS THE TIME
 *   `updated_at` comes from a trigger and is what last-write-wins compares.
 *   Whatever a client sends is ignored; a device with a wrong clock would
 *   otherwise win every conflict it took part in.
 *
 * Exports:
 *   - createSupabaseRecordStorage
 *
 * Implements: Plan 092 story 092.6.3
 *
 * Status: active
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RemoteRecordStorageAdapter,
  RecordStoreKey,
  RemoteTableSpec,
  RemoteRecord,
  RemotePushResult
} from "@sugarmagic/runtime-core";

/** Columns the mechanism owns; everything else on a row is the plugin's. */
const RECORD_KEY = "record_key";
const USER_ID = "user_id";
const DELETED = "deleted";
const UPDATED_AT = "updated_at";

function rowToRecord(row: Record<string, unknown>): RemoteRecord {
  const deleted = row[DELETED] === true;
  const { [USER_ID]: _u, [RECORD_KEY]: _k, [DELETED]: _d, [UPDATED_AT]: _t, ...columns } =
    row;
  return {
    key: String(row[RECORD_KEY]),
    // A tombstone carries no columns worth reading -- the plugin's fields are
    // whatever they were when it was deleted, and nothing should use them.
    columns: deleted ? null : columns,
    deleted,
    updatedAt: String(row[UPDATED_AT])
  };
}

export function createSupabaseRecordStorage(
  client: SupabaseClient
): RemoteRecordStorageAdapter {
  return {
    async pull(
      key: RecordStoreKey,
      table: RemoteTableSpec,
      since: string | null,
      limit: number
    ): Promise<{ records: RemoteRecord[]; nextSince: string | null }> {
      let query = client
        .from(table.tableName)
        .select("*")
        .eq(USER_ID, key.userId)
        .order(UPDATED_AT, { ascending: true })
        .limit(limit);
      if (since) query = query.gt(UPDATED_AT, since);

      const { data, error } = await query;
      if (error) {
        throw new Error(
          `[sugarprofile] pull from ${table.tableName} failed: ${error.message}`
        );
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return {
        records: rows.map(rowToRecord),
        // Only advance on a full page. A short page is the end, and advancing
        // past it would skip records sharing the last timestamp.
        nextSince:
          rows.length === limit
            ? String(rows[rows.length - 1]?.[UPDATED_AT] ?? "") || null
            : null
      };
    },

    async push(
      key: RecordStoreKey,
      table: RemoteTableSpec,
      records: ReadonlyArray<RemoteRecord>
    ): Promise<RemotePushResult> {
      if (records.length === 0) return { accepted: [] };

      const { data, error } = await client
        .from(table.tableName)
        .upsert(
          records.map((record) => ({
            [USER_ID]: key.userId,
            [RECORD_KEY]: record.key,
            [DELETED]: record.deleted,
            ...(record.columns ?? {})
            // updated_at deliberately absent -- the trigger owns it.
          })),
          { onConflict: `${USER_ID},${RECORD_KEY}` }
        )
        .select(`${RECORD_KEY}, ${UPDATED_AT}`);

      if (error) {
        throw new Error(
          `[sugarprofile] push to ${table.tableName} failed: ${error.message}`
        );
      }
      // The timestamp the database actually wrote, not one guessed here: the
      // caller records it against each local record as proof of reconciliation.
      return {
        accepted: (
          (data ?? []) as Array<Record<string, unknown>>
        ).map((row) => ({
          key: String(row[RECORD_KEY]),
          updatedAt: String(row[UPDATED_AT])
        }))
      };
    }
  };
}
