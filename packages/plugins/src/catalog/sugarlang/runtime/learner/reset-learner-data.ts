/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/reset-learner-data.ts
 *
 * Purpose: Single enforcer for wiping sugarlang-owned IndexedDB learner data (FSRS card stores + telemetry).
 *
 * Exports:
 *   - SugarlangLearnerDataResetResult
 *   - ResetSugarlangLearnerDatabasesOptions
 *   - resetSugarlangLearnerDatabases
 *
 * Relationships:
 *   - Depends on the database names owned by card-store.ts and telemetry/telemetry.ts.
 *   - Is consumed by SugarlangRuntimeServices.resetDebugState and the Studio shell reset button (ui/shell/contributions.ts).
 *
 * Implements: Epic 081 learner-reset consolidation
 *
 * Status: active
 */

import { clearPlayerStoresForPlugin } from "@sugarmagic/runtime-core";
import { SUGARLANG_PLUGIN_ID } from "../../plugin-id";
import { TELEMETRY_DB_NAME } from "../telemetry/telemetry";
// Note: every store holding a player's data -- cards, teach records, the
// encounter-debt ledger -- clears itself through the player-store registry.
// None of them are found by name.

const DEFAULT_BLOCKED_TIMEOUT_MS = 3000;

export interface SugarlangLearnerDataResetResult {
  /** True only when every sugarlang database was actually deleted. */
  ok: boolean;
  /** Stores that emptied themselves because the runtime was holding them.
   *  This is the path that reaches a player's account, not just their
   *  device. */
  clearedStores: string[];
  deletedDatabases: string[];
  /** Databases held open by a live connection past the blocked timeout. */
  blockedDatabases: string[];
  failedDatabases: string[];
}

export interface ResetSugarlangLearnerDatabasesOptions {
  /**
   * Live stores holding open connections (e.g. IndexedDBCardStore). Closed
   * before deleting so the deletes are not blocked. Callers without a runtime
   * services handle (Studio shell) omit this and rely on the stores' own
   * versionchange handlers.
   */
  closeables?: ReadonlyArray<{ close?: () => Promise<void> }>;
  indexedDbFactory?: IDBFactory | null;
  /** How long a delete may sit blocked before it is reported as failed. */
  blockedTimeoutMs?: number;
}

type DeleteOutcome = "deleted" | "blocked" | "error";

function deleteDatabase(
  factory: IDBFactory,
  name: string,
  timeoutMs: number
): Promise<DeleteOutcome> {
  return new Promise<DeleteOutcome>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (outcome: DeleteOutcome) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(outcome);
    };
    // onblocked is NOT success: a live connection without a versionchange
    // handler holds the database open and the old data survives. Wait for
    // onsuccess; if it never arrives, time out loudly and report failure.
    timer = setTimeout(() => {
      console.warn(
        `[sugarlang] deleteDatabase("${name}") blocked for ${timeoutMs}ms; ` +
          "learner data was NOT wiped. A live connection is holding it open."
      );
      settle("blocked");
    }, timeoutMs);
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => settle("deleted");
    request.onerror = () => {
      console.warn(
        `[sugarlang] deleteDatabase("${name}") failed:`,
        request.error ?? "unknown error"
      );
      settle("error");
    };
  });
}

/**
 * Deletes every sugarlang-owned IndexedDB database (FSRS card stores and
 * telemetry), first closing any live connections the caller knows about.
 * Works standalone (no runtime services required) and reports per-database
 * success/failure instead of assuming the deletes went through.
 */
export async function resetSugarlangLearnerDatabases(
  options: ResetSugarlangLearnerDatabasesOptions = {}
): Promise<SugarlangLearnerDataResetResult> {
  const result: SugarlangLearnerDataResetResult = {
    ok: true,
    clearedStores: [],
    deletedDatabases: [],
    blockedDatabases: [],
    failedDatabases: []
  };

  // ASK THE STORES FIRST. Anything the runtime currently holds knows how to
  // empty itself, and a synced store empties itself in a way that reaches the
  // player's account rather than only their device. Only what is NOT open
  // falls through to the database sweep below -- a language pair the player is
  // not using, or an account that previously used this browser.
  //
  // This used to be a sweep and nothing else, which meant a store's data was
  // only reachable while its NAME matched a pattern kept somewhere else. It
  // stopped matching the first time a store was renamed and the wipe reported
  // success having deleted nothing.
  const asked = await clearPlayerStoresForPlugin(SUGARLANG_PLUGIN_ID);
  result.clearedStores = asked.cleared;
  for (const failure of asked.failed) {
    result.ok = false;
    console.warn(
      `[sugarlang] could not clear the ${failure.storeId} store: ${failure.reason}`
    );
  }

  for (const closeable of options.closeables ?? []) {
    try {
      await closeable.close?.();
    } catch {
      // A failed close must not stop the wipe; the blocked timeout below
      // still surfaces any connection that stayed open.
    }
  }

  const factory =
    "indexedDbFactory" in options
      ? options.indexedDbFactory ?? null
      : typeof indexedDB === "undefined"
        ? null
        : indexedDB;
  if (!factory) {
    // No IndexedDB in this environment, so nothing was ever persisted.
    return result;
  }
  if (typeof factory.databases !== "function") {
    console.warn(
      "[sugarlang] IDBFactory.databases() is unavailable; cannot enumerate " +
        "learner databases for reset."
    );
    result.ok = false;
    return result;
  }

  // ONLY THE AUTHORING TELEMETRY IS SWEPT BY NAME. Learner data is cleared by
  // asking the stores above, never by matching database names.
  //
  // The sweep used to cover learner databases too, and once those names
  // carried the ACCOUNT it was deleting every account that had ever played in
  // this browser -- sign in as someone else to check something, hit reset, and
  // their words are gone as well. A pattern cannot tell whose data it is
  // matching, which is the whole reason it is the wrong tool here.
  //
  // Telemetry is different: it is the AUTHOR's own recording of their own
  // Preview sessions, one database, not per player.
  const names = (await factory.databases())
    .map((db) => db.name)
    .filter(
      (name): name is string =>
        typeof name === "string" && name.startsWith(TELEMETRY_DB_NAME)
    );

  const timeoutMs = options.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;
  await Promise.all(
    names.map(async (name) => {
      const outcome = await deleteDatabase(factory, name, timeoutMs);
      if (outcome === "deleted") {
        result.deletedDatabases.push(name);
      } else if (outcome === "blocked") {
        result.blockedDatabases.push(name);
        result.ok = false;
      } else {
        result.failedDatabases.push(name);
        result.ok = false;
      }
    })
  );

  return result;
}
