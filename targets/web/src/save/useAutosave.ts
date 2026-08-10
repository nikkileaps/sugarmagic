/**
 * targets/web/src/save/useAutosave.ts
 *
 * Drive cross-plugin game progress writes (player position,
 * region, tracked quest) from the live runtime host on a fixed
 * interval so a player's progress survives a closed tab.
 * Composes a `GameSavePayload` via
 * `host.getCurrentSavePayload()` on every tick, skips writes
 * where the payload deep-equals the last-written value, and
 * forwards through to the active save store under the active
 * userId.
 *
 * A fresh `userId` or `store` re-arms the interval (previous
 * timer cleared, lastWritten cache reset) so a sign-in or
 * mid-session store swap doesn't write the previous user's
 * payload under the new id.
 *
 * No race protection lives here. The active store is wrapped
 * by `createSerializedSaveStore` (see
 * `runtime-core/src/save/serialized-store.ts`), which is what
 * sequences in-flight writes against `resetForNewGame` and
 * freezes the store after reset. This hook can stay naive.
 *
 * A FAILING WRITE BACKS OFF, AND THE PLAYER IS TOLD
 *   This polled on a flat 5s `setInterval`, and a write that threw
 *   left `lastWritten` untouched -- so the skip test could never
 *   short-circuit and the identical payload was re-sent every 5s,
 *   720 times an hour, for as long as the failure lasted. A 401 or
 *   an RLS denial from Supabase throws, so that was reachable.
 *
 *   Unlike a warm-up (see `warm-region-teacher.ts`, same shape,
 *   found in the same sweep) this must NOT give up: abandoning a
 *   save loses the player's progress. So it keeps trying, but on a
 *   doubling delay capped at `AUTOSAVE_MAX_RETRY_DELAY_MS`, and it
 *   reports the failure so the player can be told their progress is
 *   not being saved rather than finding out when they come back.
 *
 *   The interval is now a self-rescheduling timeout, which also
 *   removes the overlap the old one allowed: `setInterval` fired
 *   every 5s whether or not the previous write had finished, so a
 *   slow store stacked writes. The next tick is now scheduled only
 *   after the previous one settles.
 *
 * Implements: Plan 047 §Story 47.10
 *
 * Status: active
 */

import { useEffect, useRef } from "react";
import {
  GAME_SAVE_SCHEMA_VERSION,
  type GameSavePayload,
  type GameSaveStore
} from "@sugarmagic/runtime-core";
import { SUGARMAGIC_VERSION } from "../version";

export interface AutosaveTickSource {
  getCurrentSavePayload(): GameSavePayload | null;
}

export interface UseAutosaveOptions {
  /** Polling interval in milliseconds. Defaults to 5000ms — fast
   *  enough that "movement → close tab → reopen" loses at most one
   *  region step, slow enough to keep IndexedDB / Supabase writes
   *  cheap. Tests inject smaller values. */
  intervalMs?: number;
  /** Story 47.10 follow-up — fired after each successful write with
   *  the GameSave that was just persisted. The host uses this to
   *  drive the Session debug HUD's Save / Last Played / Region /
   *  Quest rows so the author can see autosave happening live. */
  onWritten?: (written: {
    lastPlayed: string;
    payload: GameSavePayload;
  }) => void;
  /** Fired whenever the failing/not-failing state CHANGES, so a caller
   *  can show and clear a "your progress is not saving" notice. Not
   *  fired per failed attempt: a caller should not have to debounce. */
  onStatusChange?: (status: AutosaveStatus) => void;
}

export interface AutosaveStatus {
  /** True once `AUTOSAVE_FAILURE_NOTICE_THRESHOLD` writes in a row have
   *  failed -- the point at which this is worth interrupting a player
   *  over. Back to false on the first write that lands. */
  failing: boolean;
  /** Consecutive failed writes; 0 once one succeeds. */
  consecutiveFailures: number;
}

/** Ceiling on the retry delay. Takes a permanently failing store from 720
 *  writes an hour to 60 -- while never stopping, because the alternative is
 *  silently discarding the player's progress. */
export const AUTOSAVE_MAX_RETRY_DELAY_MS = 60_000;

/** Consecutive failures before the player is told. Five, so a blip or a
 *  brief reconnect never flashes a notice; with the default base and the
 *  ramp below that is roughly a minute of genuinely not saving. */
export const AUTOSAVE_FAILURE_NOTICE_THRESHOLD = 5;

/** Growth per consecutive failure. Gentle rather than a doubling: the
 *  steady state is the cap either way, so the only thing a steeper early
 *  ramp buys is FEWER chances to catch a store that recovers in the first
 *  half-minute, and a longer wait before the player is told. */
export const AUTOSAVE_RETRY_BACKOFF_FACTOR = 1.5;

/**
 * How long to wait before the next write attempt. Grows with each
 * consecutive failure and caps; `baseMs` while healthy.
 *
 * Pure so the backoff can be tested without a React renderer or a clock,
 * matching `runAutosaveTick` below.
 */
export function autosaveRetryDelayMs(
  consecutiveFailures: number,
  baseMs: number
): number {
  if (consecutiveFailures <= 0) return baseMs;
  return Math.min(
    Math.round(baseMs * AUTOSAVE_RETRY_BACKOFF_FACTOR ** consecutiveFailures),
    AUTOSAVE_MAX_RETRY_DELAY_MS
  );
}

export function gameSavePayloadsEqual(
  a: GameSavePayload,
  b: GameSavePayload
): boolean {
  // Payloads are JSON-serializable by construction (they round-
  // trip through GameSaveStore.save / .load). Stringify equality
  // is exact and covers `slices` — pre-055.7 this function only
  // compared the legacy 3-field carriers, which post-055.7 are
  // always null and made the check silently return true, causing
  // autosave to skip every write after the first tick. Fixed
  // 2026-07-02.
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface AutosaveTickResult {
  written: boolean;
  payload: GameSavePayload | null;
  /** Timestamp the write stamped onto the GameSave, when written. */
  lastPlayed?: string;
}

/**
 * One autosave tick: read the current payload via the source, skip
 * if equal to `lastWritten`, otherwise write to the store and return
 * the new lastWritten. Pure logic so test code can drive it without
 * a React renderer. The hook below is a thin setInterval wrapper.
 */
export async function runAutosaveTick(args: {
  source: AutosaveTickSource;
  store: GameSaveStore;
  userId: string;
  lastWritten: GameSavePayload | null;
  nowIso?: () => string;
}): Promise<AutosaveTickResult> {
  const payload = args.source.getCurrentSavePayload();
  if (!payload) return { written: false, payload: args.lastWritten };
  if (args.lastWritten && gameSavePayloadsEqual(payload, args.lastWritten)) {
    return { written: false, payload: args.lastWritten };
  }
  const lastPlayed = args.nowIso ? args.nowIso() : new Date().toISOString();
  await args.store.save(args.userId, {
    userId: args.userId,
    lastPlayed,
    schemaVersion: GAME_SAVE_SCHEMA_VERSION,
    writtenByVersion: SUGARMAGIC_VERSION,
    payload
  });
  return { written: true, payload, lastPlayed };
}

/**
 * Story 47.10 — polls the host's live save payload on a fixed
 * interval and writes through to the active store when something
 * changed. Inactive when `userId` is null (anonymous fallback may
 * still be running but the caller has chosen not to persist) or
 * `store` is null (boot hasn't resolved providers yet).
 *
 * Returns nothing: callers don't need to coordinate with this
 * hook around destructive flows like start-new-game. The store
 * (`SerializedSaveStore`) is the enforcer.
 */
export function useAutosave(
  source: AutosaveTickSource | null,
  store: GameSaveStore | null,
  userId: string | null,
  options: UseAutosaveOptions = {}
): void {
  const intervalMs = options.intervalMs ?? 5000;
  const lastWrittenRef = useRef<GameSavePayload | null>(null);
  const onWrittenRef = useRef(options.onWritten);
  onWrittenRef.current = options.onWritten;
  const onStatusChangeRef = useRef(options.onStatusChange);
  onStatusChangeRef.current = options.onStatusChange;

  useEffect(() => {
    if (!source || !store || !userId) return;
    lastWrittenRef.current = null;
    let cancelled = false;
    let timer: number | null = null;
    let consecutiveFailures = 0;
    let noticeShown = false;

    /** Fire only on a CHANGE, so a caller can bind this straight to a
     *  notice without debouncing it. */
    function reportStatus(): void {
      const failing = consecutiveFailures >= AUTOSAVE_FAILURE_NOTICE_THRESHOLD;
      if (failing === noticeShown) return;
      noticeShown = failing;
      onStatusChangeRef.current?.({ failing, consecutiveFailures });
    }

    async function tick() {
      if (cancelled) return;
      if (!source || !store || !userId) return;
      try {
        const result = await runAutosaveTick({
          source,
          store,
          userId,
          lastWritten: lastWrittenRef.current
        });
        if (cancelled) return;
        if (result.written && result.payload && result.lastPlayed) {
          lastWrittenRef.current = result.payload;
          onWrittenRef.current?.({
            lastPlayed: result.lastPlayed,
            payload: result.payload
          });
        }
        // A skipped write (payload unchanged) counts as healthy: the store
        // was never asked, so it is not evidence of a problem, and treating
        // it as a failure would back off an idle player for no reason.
        consecutiveFailures = 0;
        reportStatus();
      } catch (error) {
        if (cancelled) return;
        consecutiveFailures += 1;
        console.warn(
          `[autosave] write failed (${consecutiveFailures} in a row); retrying in ` +
            `${autosaveRetryDelayMs(consecutiveFailures, intervalMs)}ms`,
          { userId, error }
        );
        reportStatus();
      }
    }

    // A self-rescheduling timeout rather than setInterval: the delay has to
    // vary with the backoff, and scheduling the next tick only after this
    // one settles is also what stops a slow store stacking overlapping
    // writes.
    function schedule(delayMs: number): void {
      timer = window.setTimeout(() => {
        void tick().finally(() => {
          if (cancelled) return;
          schedule(autosaveRetryDelayMs(consecutiveFailures, intervalMs));
        });
      }, delayMs);
    }
    schedule(intervalMs);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [source, store, userId, intervalMs]);
}
