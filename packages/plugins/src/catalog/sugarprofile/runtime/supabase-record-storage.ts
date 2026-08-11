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

/**
 * How far `pull` may grow a page when every row on it shares one timestamp.
 *
 * A push writes at most one sync batch per transaction, so doubling once
 * already clears the largest group this client can create. The cap exists for
 * a group made some other way -- a migration, a bulk import -- so an odd data
 * shape cannot turn one pull into an unbounded read.
 */
const MAX_PAGE_GROWTH = 8;

/**
 * One database row as the sync engine's wire type.
 *
 * The four reserved columns come off `columns` because the mechanism carries
 * each of them in its own field -- `record_key` as `key`, and so on. The engine
 * puts `record_key` BACK on the row before a table spec reads it, so a spec
 * still sees the column it stored. Do not add it to `columns` here as well:
 * that would give the engine two sources for one value.
 */
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
    /**
     * One page of what the account has seen since `since`.
     *
     * `updated_at` IS NOT UNIQUE, and the paging has to survive that. The
     * trigger stamps `now()`, which in Postgres is the TRANSACTION time, so a
     * batch upsert gives every row it wrote the identical value -- up to 250 of
     * them from a single push.
     *
     * The old version ordered on `updated_at` alone and advanced the cursor
     * past the last row's timestamp. When a page boundary fell inside a group
     * sharing one timestamp, the rest of that group was jumped over and never
     * offered again: 200 rows at T1 then 200 at T2, read 250 at a time, loses
     * 150 records permanently.
     *
     * WHY NOT A COMPOUND CURSOR. The textbook fix is a keyset predicate on
     * `(updated_at, record_key)`, which needs `or=(...,and(...))` -- a filter
     * built by pasting a record key into a query string. PostgREST requires
     * reserved characters in filter values to be double-quoted and does not
     * document how to escape a value containing quotes; postgrest-js has an
     * open issue for it. This mechanism is generic over every plugin's keys, so
     * that is a trap waiting for the first key with a comma in it. Ordering by
     * `record_key` is free -- it is a column name, not a value -- so the page is
     * deterministic; the cursor stays a timestamp and never carries a key.
     *
     * Instead the page is TRIMMED to a timestamp boundary: drop the trailing
     * rows that share the last timestamp and stop just short of them. They
     * arrive at the head of the next page. Costs re-reading one group per page.
     */
    async pull(
      key: RecordStoreKey,
      table: RemoteTableSpec,
      since: string | null,
      limit: number
    ): Promise<{
      records: RemoteRecord[];
      cursor: string | null;
      hasMore: boolean;
    }> {
      // Grows only when an entire page turns out to be one timestamp, which
      // means the group cannot be split at any boundary inside it. Doubling
      // once clears a full 250-row batch; the cap stops a pathological group
      // turning into an unbounded read.
      for (let pageLimit = limit; ; pageLimit *= 2) {
        let query = client
          .from(table.tableName)
          .select("*")
          .eq(USER_ID, key.userId)
          .order(UPDATED_AT, { ascending: true })
          // A tiebreaker in the ORDER BY only. Without it Postgres may return
          // rows sharing a timestamp in a different order each time, and the
          // trimming below assumes the page is stable.
          .order(RECORD_KEY, { ascending: true })
          .limit(pageLimit);
        if (since) query = query.gt(UPDATED_AT, since);

        const { data, error } = await query;
        if (error) {
          throw new Error(
            `[sugarprofile] pull from ${table.tableName} failed: ${error.message}`
          );
        }
        const rows = (data ?? []) as Array<Record<string, unknown>>;

        // A short page is the end of the account's history. Everything is
        // here -- including the whole of the last timestamp's group -- so the
        // cursor CAN safely move to it. Not doing so is what made an account
        // smaller than one page re-download itself on every pass.
        if (rows.length < pageLimit) {
          return {
            records: rows.map(rowToRecord),
            cursor: String(rows[rows.length - 1]?.[UPDATED_AT] ?? "") || null,
            hasMore: false
          };
        }

        const lastStamp = String(rows[rows.length - 1]?.[UPDATED_AT] ?? "");
        const kept = rows.filter(
          (row) => String(row[UPDATED_AT]) !== lastStamp
        );

        if (kept.length > 0) {
          return {
            records: kept.map(rowToRecord),
            cursor: String(kept[kept.length - 1]?.[UPDATED_AT] ?? "") || null,
            hasMore: true
          };
        }

        // Every row on this page shares one timestamp, so there is no boundary
        // to stop at and no way to know whether more of the group follows.
        if (pageLimit >= limit * MAX_PAGE_GROWTH) {
          // Taking the page and moving past the timestamp is the only way to
          // make progress, and it may skip the tail of a group this large.
          // Loud, because it is the one path here that can lose a record.
          console.warn(
            `[sugarprofile] ${table.tableName}: over ${pageLimit} rows share the ` +
              `timestamp ${lastStamp}; advancing past it may skip some. This ` +
              "means one transaction wrote more rows than a sync page can hold.",
            { userId: key.userId }
          );
          return {
            records: rows.map(rowToRecord),
            cursor: lastStamp || null,
            hasMore: true
          };
        }
      }
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
