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

import { CARD_STORE_DB_NAME_PREFIX } from "./card-store";
import { TELEMETRY_DB_NAME } from "../telemetry/telemetry";
// Note: teach-record DBs (085.5) use the prefix "${CARD_STORE_DB_NAME_PREFIX}:teach:" and are
// automatically covered by the CARD_STORE_DB_NAME_PREFIX startsWith check below.

const DEFAULT_BLOCKED_TIMEOUT_MS = 3000;

export interface SugarlangLearnerDataResetResult {
  /** True only when every sugarlang database was actually deleted. */
  ok: boolean;
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
    deletedDatabases: [],
    blockedDatabases: [],
    failedDatabases: []
  };

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

  const names = (await factory.databases())
    .map((db) => db.name)
    .filter(
      (name): name is string =>
        typeof name === "string" &&
        // CONTAINS, not startsWith: a learner database name leads with the
        // GAME id now, so the plugin's segment sits in the middle. Matching
        // on the prefix would silently delete nothing.
        (name.includes(CARD_STORE_DB_NAME_PREFIX) ||
          name.startsWith(TELEMETRY_DB_NAME))
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
