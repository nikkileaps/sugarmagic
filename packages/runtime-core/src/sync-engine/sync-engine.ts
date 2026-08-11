/**
 * packages/runtime-core/src/sync-engine/sync.ts
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
 *   - createSyncEngine
 *   - SyncEngine, SyncResult
 *   - SYNC_INTERVAL_MS, SYNC_MAX_INTERVAL_MS, SYNC_BATCH
 *
 * Implements: Plan 092 story 092.6.3
 *
 * Status: active
 */

import {
  listSyncedRecordStores,
  setSyncedStoreRegistrationListener,
  type RemoteRecordStorageAdapter,
  type SyncHandle,
  type RemoteRecord
} from "./index";

/** Gap between passes while everything is healthy. */
export const SYNC_INTERVAL_MS = 30_000;

/** Ceiling once passes keep failing. */
export const SYNC_MAX_INTERVAL_MS = 300_000;

/** Records per push or pull request. */
export const SYNC_BATCH = 250;


export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Remote records skipped because this device had an unpushed edit. */
  conflictsKeptLocal: number;
  failures: number;
}

export interface SyncEngine {
  /** One pass over every registered store. Never throws. */
  syncNow(reason: string): Promise<SyncResult>;
  /**
   * Begin the interval and the browser triggers, and hand back the FIRST
   * pass so boot can wait for it.
   *
   * A returning player's data has to be in place before they can do anything
   * with it. Left to the interval, the first pull races the player: reach a
   * conversation before it lands and the game reads an empty store, teaches
   * words already known, and then quietly corrects itself later. Waiting is
   * the boot screen's job, which is why it is handed back rather than kept.
   */
  start(): Promise<void>;
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

export interface CreateSyncEngineOptions {
  /** Null means nothing to sync against; every pass is a no-op. */
  remote: RemoteRecordStorageAdapter | null;
  logger?: SyncLogger;
  intervalMs?: number;
  /** Test seam. Defaults to the registry. */
  listStores?: () => SyncHandle[];
  /** Test seam for the browser triggers. */
  ownerWindow?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
}

export function createSyncEngine(
  options: CreateSyncEngineOptions
): SyncEngine {
  const logger = options.logger ?? defaultLogger;
  const baseIntervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
  const listStores = options.listStores ?? listSyncedRecordStores;
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
  /**
   * A store appeared while a pass was in flight. That pass was already
   * iterating its own list and cannot pick the newcomer up, so the next pass
   * runs immediately instead of an interval later -- something is waiting on
   * that store's first sync, and up to 30 seconds of loading screen is not the
   * answer.
   */
  let registeredDuringPass = false;

  async function syncStore(
    handle: SyncHandle,
    remote: RemoteRecordStorageAdapter,
    result: SyncResult
  ): Promise<void> {
    // PULL FIRST, and on a store that has never pulled, do not push at all.
    //
    // A device that has not heard what the account holds cannot safely write
    // to it. Everything in its store is either untouched or invented from a
    // default, and pushing that is a blind overwrite: a returning player's
    // real level, replaced by the empty one this device made up because it
    // read the store before anything had filled it.
    //
    // The order used to be the other way round, on the reasoning that pushing
    // first saves reporting a conflict against a record the server was about
    // to be told about anyway. That is still true and still worth little --
    // and the comment saying the order does not affect safety was only right
    // while every store was assumed to have pulled already.
    //
    // THE ORDER IS THE ENFORCEMENT. A pull that fails throws out of here, so
    // the push below never runs and the records stay pending for the next
    // pass. There is no separate "have we pulled" check to keep in step.
    let since = await handle.getWatermark();
    for (;;) {
      const page = await remote.pull(
        handle.storeKey,
        handle.table,
        since,
        SYNC_BATCH
      );
      if (page.records.length > 0) {
        const applied = await handle.applyRemote(page.records);
        result.pulled += applied.applied;
        result.conflictsKeptLocal += applied.skippedLocalNewer;
      }
      if (!page.nextSince) break;
      since = page.nextSince;
      await handle.setWatermark(since);
    }
    // AFTER the whole pull, not after the first page: every page of a first
    // pull is still the first pull, and flipping this early would let page two
    // start losing to unpushed local records that page one outranked.
    const wasFirstPull = !handle.hasPulled();
    handle.markPulled();
    if (wasFirstPull) {
      logger.info(
        `[sync-engine] first pull complete for ${handle.storeKey.pluginId}:${handle.storeKey.storeId}`
      );
    }

    for (;;) {
      const pending = await handle.takePending(SYNC_BATCH);
      if (pending.length === 0) break;
      const outgoing: RemoteRecord[] = pending.map((record) => ({
        key: record.key,
        // A tombstone sends no columns: the row is being marked gone, and the
        // plugin's fields are whatever they were.
        columns:
          record.deleted || record.data === null
            ? null
            : handle.table.toColumns(record.data),
        deleted: record.deleted,
        // Ignored by the server, which stamps its own.
        updatedAt: new Date(record.updatedAtMs).toISOString()
      }));
      const pushed = await remote.push(handle.storeKey, handle.table, outgoing);
      await handle.markPushed(pushed.accepted);
      result.pushed += pushed.accepted.length;
      // A server that accepts nothing would spin here forever on the same
      // batch. Stop and let the next pass try again.
      if (pushed.accepted.length === 0) break;
      if (pending.length < SYNC_BATCH) break;
    }
  }

  async function syncNow(reason: string): Promise<SyncResult> {
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflictsKeptLocal: 0,
      failures: 0
    };
    const remote = options.remote;
    if (!remote) {
      // No backend is a supported configuration, so every store's wait ends
      // rather than leaving a caller waiting on a reconcile that cannot come.
      for (const handle of listStores()) handle.markFirstSyncDone();
      return result;
    }

    for (const handle of listStores()) {
      try {
        await syncStore(handle, remote, result);
      } catch (error) {
        // One broken store must not stop the others. Its pending records stay
        // pending, so nothing is lost by this pass failing.
        result.failures += 1;
        logger.warn(
          `[sync-engine] sync failed for ${handle.storeKey.pluginId}:${handle.storeKey.storeId}`,
          error
        );
      } finally {
        // RUNS ON FAILURE TOO. This answers "has this store had its
        // turn", not "did the data arrive" -- a game whose backend is down
        // still has to start, and the local copy is what it plays from.
        handle.markFirstSyncDone();
      }
    }

    if (result.conflictsKeptLocal > 0) {
      // Named rather than swallowed: this is the shape where someone loses an
      // edit and cannot tell you why.
      logger.info(
        `[sync-engine] ${result.conflictsKeptLocal} remote record(s) kept local, ` +
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
      SYNC_MAX_INTERVAL_MS
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
    registeredDuringPass = false;
    try {
      await syncNow(reason);
    } finally {
      running = false;
      if (registeredDuringPass) {
        registeredDuringPass = false;
        schedule(0);
      } else {
        schedule(nextDelayMs());
      }
    }
  }

  /**
   * A store built after boot -- the learner's, on the first conversation turn
   * -- missed every pass so far, and something is waiting on its first sync. Reconcile
   * it now rather than at the next tick.
   */
  function onStoreRegistered(_handle: SyncHandle): void {
    if (stopped) return;
    if (running) {
      registeredDuringPass = true;
      return;
    }
    void run("store registered");
  }

  // CLAIMED AT CREATION, NOT AT `start()`. Plugins open their storage between
  // this engine being built and being started, and an unclaimed listener means
  // "nothing will ever sync this store" -- so those stores would end their
  // first-sync wait immediately, before a single pass had run. While stopped,
  // `onStoreRegistered` does nothing; the first pass picks the store up from
  // the registry and ends the wait properly.
  setSyncedStoreRegistrationListener(onStoreRegistered);

  const onOnline = () => void run("came back online");
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void run("tab hidden");
    }
  };

  return {
    syncNow,

    async start() {
      if (!stopped) return;
      stopped = false;
      ownerWindow?.addEventListener("online", onOnline);
      ownerWindow?.addEventListener("visibilitychange", onVisibility);
      // Awaited by the caller, not fired and forgotten: this pass is what
      // brings a returning player's data back, and everything after it is
      // wrong until it lands.
      await run("started");
    },

    stop() {
      stopped = true;
      // Released so a store built after this ends its own wait rather than
      // waiting on a loop that is no longer running.
      setSyncedStoreRegistrationListener(null);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      ownerWindow?.removeEventListener("online", onOnline);
      ownerWindow?.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
