/**
 * packages/runtime-core/src/account-data/sync.ts
 *
 * Purpose: Reconciles every synced account store with the player's account.
 *
 * PUSH WHAT CHANGED, PULL WHAT IS NEWER
 *   Each pass sends the records edited on this device since the last pass,
 *   then asks for anything the account has seen since a watermark. Neither
 *   side sends everything: the pending index finds local edits without
 *   scanning, and the watermark keeps the pull proportional to what actually
 *   changed rather than to how much the player knows.
 *
 * THE SERVER OWNS THE CLOCK
 *   Ordering uses the timestamp the server stamps, not this device's. Client
 *   clocks disagree by minutes and a wrong one silently wins every argument it
 *   is in. Conflicts resolve last-write-wins, which is the right trade here --
 *   one person, occasionally two devices, rarely at once. The known hazard is
 *   a local write quietly losing to a remote one, so that case is COUNTED AND
 *   LOGGED rather than swallowed; a silent overwrite is indistinguishable from
 *   data loss when someone reports it later.
 *
 * IT RUNS ON ITS OWN CADENCE
 *   Never on the autosave heartbeat. That path re-serialises its whole payload
 *   every few seconds to detect change, so putting anything that grows on it
 *   makes every heartbeat more expensive. This runs on a slower interval and
 *   on the moments that actually matter: signing in, coming back online, and
 *   the tab being hidden.
 *
 * FAILURE IS EXPECTED AND BOUNDED
 *   A pass that throws leaves the local copy untouched and pending records
 *   pending, so the next pass retries them; nothing is lost by failing. The
 *   interval backs off while it keeps failing rather than hammering a broken
 *   backend, because a warm loop against a 401 is how a gateway outage turns
 *   into a bill.
 *
 * Exports:
 *   - createAccountDataSync
 *   - AccountDataSync, AccountDataSyncResult
 *   - ACCOUNT_SYNC_INTERVAL_MS, ACCOUNT_SYNC_MAX_INTERVAL_MS, ACCOUNT_SYNC_BATCH
 *
 * Implements: Plan 092 story 092.6.3
 *
 * Status: active
 */

import {
  listSyncedAccountStores,
  type AccountDataRemote,
  type AccountStoreSyncHandle,
  type RemoteAccountRecord
} from "./index";

/** Gap between passes while everything is healthy. */
export const ACCOUNT_SYNC_INTERVAL_MS = 30_000;

/** Ceiling once passes keep failing. */
export const ACCOUNT_SYNC_MAX_INTERVAL_MS = 300_000;

/** Records per push or pull request. */
export const ACCOUNT_SYNC_BATCH = 250;

export interface AccountDataSyncResult {
  pushed: number;
  pulled: number;
  /** Remote records skipped because this device had an unpushed edit. */
  conflictsKeptLocal: number;
  failures: number;
}

export interface AccountDataSync {
  /** One pass over every registered store. Never throws. */
  syncNow(reason: string): Promise<AccountDataSyncResult>;
  /** Begin the interval and the browser triggers. */
  start(): void;
  stop(): void;
}

interface SyncLogger {
  info: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
}

const defaultLogger: SyncLogger = {
  info: (message, detail) => console.info(message, detail ?? ""),
  warn: (message, detail) => console.warn(message, detail ?? "")
};

export interface CreateAccountDataSyncOptions {
  /** Null means nothing to sync against; every pass is a no-op. */
  remote: AccountDataRemote | null;
  logger?: SyncLogger;
  intervalMs?: number;
  /** Test seam. Defaults to the registry. */
  listStores?: () => AccountStoreSyncHandle[];
  /** Test seam for the browser triggers. */
  ownerWindow?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
}

export function createAccountDataSync(
  options: CreateAccountDataSyncOptions
): AccountDataSync {
  const logger = options.logger ?? defaultLogger;
  const baseIntervalMs = options.intervalMs ?? ACCOUNT_SYNC_INTERVAL_MS;
  const listStores = options.listStores ?? listSyncedAccountStores;
  const ownerWindow =
    options.ownerWindow === undefined
      ? typeof window !== "undefined"
        ? window
        : null
      : options.ownerWindow;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = true;
  let consecutiveFailures = 0;

  async function syncStore(
    handle: AccountStoreSyncHandle,
    remote: AccountDataRemote,
    result: AccountDataSyncResult
  ): Promise<void> {
    // Push first so the account has this device's edits before we ask what
    // changed -- it keeps a pass from reporting a conflict against a record
    // the server was about to be told about anyway. It is NOT what protects
    // the edit: `applyRemote` refuses to overwrite a record still marked
    // pending, and that guard holds whichever order these run in.
    for (;;) {
      const pending = await handle.takePending(ACCOUNT_SYNC_BATCH);
      if (pending.length === 0) break;
      const outgoing: RemoteAccountRecord[] = pending.map((record) => ({
        key: record.key,
        data: record.data,
        schemaVersion: record.schemaVersion,
        deleted: record.deleted,
        // Ignored by the server, which stamps its own. Sent so a backend that
        // wants to reject a stale write has something to compare.
        updatedAt: new Date(record.updatedAtMs).toISOString()
      }));
      const pushed = await remote.push(handle.storeKey, outgoing);
      await handle.markPushed(pushed.accepted);
      result.pushed += pushed.accepted.length;
      // A server that accepts nothing would spin here forever on the same
      // batch. Stop and let the next pass try again.
      if (pushed.accepted.length === 0) break;
      if (pending.length < ACCOUNT_SYNC_BATCH) break;
    }

    let since = await handle.getWatermark();
    for (;;) {
      const page = await remote.pull(handle.storeKey, since, ACCOUNT_SYNC_BATCH);
      if (page.records.length > 0) {
        const applied = await handle.applyRemote(page.records);
        result.pulled += applied.applied;
        result.conflictsKeptLocal += applied.skippedLocalNewer;
      }
      if (!page.nextSince) break;
      since = page.nextSince;
      await handle.setWatermark(since);
    }
  }

  async function syncNow(reason: string): Promise<AccountDataSyncResult> {
    const result: AccountDataSyncResult = {
      pushed: 0,
      pulled: 0,
      conflictsKeptLocal: 0,
      failures: 0
    };
    const remote = options.remote;
    if (!remote) return result;

    for (const handle of listStores()) {
      try {
        await syncStore(handle, remote, result);
      } catch (error) {
        // One broken store must not stop the others. Its pending records stay
        // pending, so nothing is lost by this pass failing.
        result.failures += 1;
        logger.warn(
          `[account-data] sync failed for ${handle.storeKey.pluginId}:${handle.storeKey.storeId}`,
          error
        );
      }
    }

    if (result.conflictsKeptLocal > 0) {
      // Named rather than swallowed: this is the shape where someone loses an
      // edit and cannot tell you why.
      logger.info(
        `[account-data] ${result.conflictsKeptLocal} remote record(s) kept local, ` +
          `unpushed edits won (${reason})`
      );
    }
    consecutiveFailures = result.failures > 0 ? consecutiveFailures + 1 : 0;
    return result;
  }

  function nextDelayMs(): number {
    if (consecutiveFailures === 0) return baseIntervalMs;
    return Math.min(
      baseIntervalMs * 2 ** consecutiveFailures,
      ACCOUNT_SYNC_MAX_INTERVAL_MS
    );
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void run("interval");
    }, delayMs);
  }

  async function run(reason: string): Promise<void> {
    // A pass already in flight: skip rather than queue. Two passes over one
    // store would push the same records twice.
    if (running || stopped) return;
    running = true;
    try {
      await syncNow(reason);
    } finally {
      running = false;
      schedule(nextDelayMs());
    }
  }

  const onOnline = () => void run("came back online");
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void run("tab hidden");
    }
  };

  return {
    syncNow,

    start() {
      if (!stopped) return;
      stopped = false;
      ownerWindow?.addEventListener("online", onOnline);
      ownerWindow?.addEventListener("visibilitychange", onVisibility);
      // A first pass straight away: signing in is the moment a returning
      // player most wants their own data back.
      void run("started");
    },

    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      ownerWindow?.removeEventListener("online", onOnline);
      ownerWindow?.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
