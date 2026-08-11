/**
 * packages/testing/src/sync-engine-supabase-pull.test.ts
 *
 * Purpose: Paging through an account's history when timestamps repeat
 *   (Plan 092.6.3).
 *
 * THE BUG THIS LOCKS OUT
 *   `updated_at` is stamped by a trigger calling `now()`, which in Postgres is
 *   the TRANSACTION time -- so every row written by one batch upsert shares a
 *   single value, up to a whole sync batch of them. Paging ordered on that
 *   column alone and advancing past the last row's timestamp jumps the rest of
 *   any group straddling a page boundary. Those records are never offered
 *   again: not a delay, a permanent hole, and nothing reports it.
 *
 *   The fake below is deliberately faithful about the two things that matter:
 *   it applies `limit` AFTER ordering, and it lets many rows share a timestamp.
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import type { RemoteTableSpec, RecordStoreKey } from "@sugarmagic/runtime-core";
import { createSupabaseRecordStorage } from "@sugarmagic/plugins";

/** Taken from the function under test rather than by depending on supabase-js
 *  for one type. */
type SupabaseClient = Parameters<typeof createSupabaseRecordStorage>[0];

interface Row {
  user_id: string;
  record_key: string;
  updated_at: string;
  deleted: boolean;
  lemma: string;
}

const STORE_KEY: RecordStoreKey = {
  pluginId: "example-plugin",
  storeId: "words",
  userId: "user-alice"
};

const TABLE: RemoteTableSpec = {
  tableName: "example_words",
  toColumns: (data) => ({ lemma: (data as { lemma: string }).lemma }),
  fromRow: (row) => ({ lemma: String(row.lemma) })
};

/** Rows sharing one timestamp, which is what a batch upsert produces. */
function group(stamp: string, keys: string[]): Row[] {
  return keys.map((record_key) => ({
    user_id: STORE_KEY.userId,
    record_key,
    updated_at: stamp,
    deleted: false,
    lemma: record_key
  }));
}

/**
 * Enough of the query builder to be wrong in the same ways the real one is:
 * ordering is applied first, `limit` truncates afterwards.
 */
function fakeClient(rows: Row[]): { client: SupabaseClient; reads: number } {
  const state = { reads: 0 };
  const builder = () => {
    let filtered = [...rows];
    const orderBy: Array<keyof Row> = [];
    let take = Infinity;
    const chain = {
      select: () => chain,
      eq: (column: keyof Row, value: unknown) => {
        filtered = filtered.filter((row) => row[column] === value);
        return chain;
      },
      gt: (column: keyof Row, value: string) => {
        filtered = filtered.filter((row) => String(row[column]) > value);
        return chain;
      },
      order: (column: keyof Row) => {
        orderBy.push(column);
        return chain;
      },
      limit: (n: number) => {
        take = n;
        return chain;
      },
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
        state.reads += 1;
        const sorted = [...filtered].sort((left, right) => {
          for (const column of orderBy) {
            const a = String(left[column]);
            const b = String(right[column]);
            if (a !== b) return a < b ? -1 : 1;
          }
          return 0;
        });
        return resolve({ data: sorted.slice(0, take), error: null });
      }
    };
    return chain;
  };
  return {
    client: { from: () => builder() } as unknown as SupabaseClient,
    reads: state.reads
  };
}

/** Walks every page the way the sync loop does, collecting what it is given. */
async function pullEverything(rows: Row[], limit: number): Promise<string[]> {
  const { client } = fakeClient(rows);
  const storage = createSupabaseRecordStorage(client);
  const seen: string[] = [];
  let since: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const result = await storage.pull(STORE_KEY, TABLE, since, limit);
    seen.push(...result.records.map((record) => record.key));
    if (!result.nextSince) return seen;
    since = result.nextSince;
  }
  throw new Error("pull did not terminate");
}

describe("092.6.3 - paging an account's history over repeated timestamps", () => {
  it("THE ONE THAT MATTERS: a group straddling a page boundary is not skipped", async () => {
    // 200 rows at T1 then 200 at T2, read 250 at a time. The old paging filled
    // page one with all of T1 plus 50 of T2, moved the cursor to T2, and asked
    // for everything AFTER T2 -- losing the other 150 permanently.
    const rows = [
      ...group("2026-01-01T00:00:00.000Z", Array.from({ length: 200 }, (_, i) => `a${String(i).padStart(3, "0")}`)),
      ...group("2026-01-02T00:00:00.000Z", Array.from({ length: 200 }, (_, i) => `b${String(i).padStart(3, "0")}`))
    ];

    const seen = await pullEverything(rows, 250);

    expect(seen).toHaveLength(400);
    expect(new Set(seen).size).toBe(400);
  });

  it("delivers every record when they ALL share one timestamp", async () => {
    // One batch upsert of exactly a page's worth. There is no boundary inside
    // it to stop at, so the page has to grow rather than guess.
    const rows = group(
      "2026-01-01T00:00:00.000Z",
      Array.from({ length: 250 }, (_, i) => `w${String(i).padStart(3, "0")}`)
    );

    const seen = await pullEverything(rows, 250);

    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  it("hands back every record when nothing shares a timestamp", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      group(`2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`, [`w${i}`])
    ).flat();

    const seen = await pullEverything(rows, 10);

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  it("says so loudly rather than silently skipping when a group cannot fit", async () => {
    // A group larger than the page can grow to. Progress requires stepping past
    // the timestamp, which may drop its tail -- the one path here that can lose
    // a record, so it must not be quiet.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = group(
      "2026-01-01T00:00:00.000Z",
      Array.from({ length: 5_000 }, (_, i) => `w${String(i).padStart(4, "0")}`)
    );

    const { client } = fakeClient(rows);
    await createSupabaseRecordStorage(client).pull(STORE_KEY, TABLE, null, 4);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops at the end rather than asking forever", async () => {
    const seen = await pullEverything([], 250);
    expect(seen).toEqual([]);
  });
});
