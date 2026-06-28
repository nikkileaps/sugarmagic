/**
 * targets/web/src/save/useAutosave.ts
 *
 * Purpose: Drive cross-plugin game progress writes (player position,
 * region, tracked quest) from the live runtime host on a fixed
 * interval so a player's progress survives a closed tab or browser
 * crash. The hook composes a `GameSavePayload` via
 * `host.getCurrentSavePayload()` on every tick, skips writes where
 * the payload deep-equals the last-written value, and forwards the
 * write to the active save store under the active userId.
 *
 * Cancellation: a fresh `userId` or `store` re-arms the interval
 * (previous timer cleared, lastWritten cache reset) so a sign-in or
 * mid-session store swap doesn't accidentally write the previous
 * user's payload under the new id.
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
}

export function gameSavePayloadsEqual(
  a: GameSavePayload,
  b: GameSavePayload
): boolean {
  if (a.currentRegionId !== b.currentRegionId) return false;
  if (a.currentQuestId !== b.currentQuestId) return false;
  const ap = a.playerPosition;
  const bp = b.playerPosition;
  if (ap === bp) return true;
  if (!ap || !bp) return false;
  return ap.x === bp.x && ap.y === bp.y && ap.z === bp.z;
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
    payload
  });
  return { written: true, payload, lastPlayed };
}

/**
 * Story 053.7 — handle returned by `useAutosave` so the calling
 * component can stop autosave + flush any in-flight write before
 * doing something save-state-destructive (deleting the save,
 * navigating away, etc.). Without this, the New Game reset flow
 * could call `store.clear(userId)` while an autosave tick was in
 * the middle of `await store.save(userId, ...)`; that pending
 * save would resolve AFTER the clear and the next boot would
 * read stale player position back from the store.
 *
 * Contract:
 *   - `halt()` flips an internal "halted" flag (so any future
 *     interval ticks bail at the top), then awaits any
 *     write Promise currently in flight. After it resolves, no
 *     more writes will happen from this hook until the hook
 *     unmounts and a fresh one mounts.
 *   - Safe to call multiple times; subsequent calls await whatever
 *     write is in flight (or resolve immediately).
 *   - `halt()` does NOT clear the saved data — that's the caller's
 *     job (e.g. `store.clear()`).
 */
export interface AutosaveHandle {
  halt(): Promise<void>;
}

/**
 * Story 47.10 — polls the host's live save payload on a fixed
 * interval and writes through to the active store when something
 * changed. Inactive when `userId` is null (anonymous fallback may
 * still be running but the caller has chosen not to persist) or
 * `store` is null (boot hasn't resolved providers yet).
 *
 * Story 053.7 — returns an `AutosaveHandle`. Callers about to
 * mutate save-state (start-new-game, sign-out, account deletion)
 * MUST `await handle.halt()` before destructive store operations
 * so an in-flight tick can't race past them.
 */
export function useAutosave(
  source: AutosaveTickSource | null,
  store: GameSaveStore | null,
  userId: string | null,
  options: UseAutosaveOptions = {}
): AutosaveHandle {
  const intervalMs = options.intervalMs ?? 5000;
  const lastWrittenRef = useRef<GameSavePayload | null>(null);
  const onWrittenRef = useRef(options.onWritten);
  onWrittenRef.current = options.onWritten;
  // Story 053.7 — both refs are populated by the effect below and
  // read by the `halt` closure returned from the hook.
  const haltedRef = useRef<boolean>(false);
  const inFlightWriteRef = useRef<Promise<AutosaveTickResult> | null>(null);

  useEffect(() => {
    if (!source || !store || !userId) return;
    lastWrittenRef.current = null;
    // Each (source, store, userId) generation gets a fresh halted
    // flag — re-mounting (e.g. after a sign-in) re-arms autosave.
    haltedRef.current = false;
    let cancelled = false;

    async function tick() {
      if (cancelled || haltedRef.current) return;
      if (!source || !store || !userId) return;
      try {
        const writePromise = runAutosaveTick({
          source,
          store,
          userId,
          lastWritten: lastWrittenRef.current
        });
        // Story 053.7 — publish the in-flight Promise before
        // awaiting so a concurrent `halt()` call can wait on it.
        inFlightWriteRef.current = writePromise;
        const result = await writePromise;
        if (inFlightWriteRef.current === writePromise) {
          inFlightWriteRef.current = null;
        }
        if (
          !cancelled &&
          !haltedRef.current &&
          result.written &&
          result.payload &&
          result.lastPlayed
        ) {
          lastWrittenRef.current = result.payload;
          onWrittenRef.current?.({
            lastPlayed: result.lastPlayed,
            payload: result.payload
          });
        }
      } catch (error) {
        if (inFlightWriteRef.current) inFlightWriteRef.current = null;
        console.warn("[autosave] write failed; will retry on next tick", {
          userId,
          error
        });
      }
    }

    const id = window.setInterval(() => {
      void tick();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [source, store, userId, intervalMs]);

  return {
    halt: async () => {
      haltedRef.current = true;
      const pending = inFlightWriteRef.current;
      if (pending) {
        try {
          await pending;
        } catch {
          // tick() already logged its own warning.
        }
      }
    }
  };
}
