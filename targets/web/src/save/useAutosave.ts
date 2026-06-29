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
 * Race protection: NONE here. The previous 053.7 halt() handle
 * lived in this hook and required every save-state-mutating
 * callsite (start-new-game, sign-out, account deletion) to call it
 * first. That contract was fragile — the haltedRef reset whenever
 * the hook's deps changed, and any new caller had to remember the
 * rule. The structural replacement is a `SerializedSaveStore`
 * wrapping every active store (see
 * `runtime-core/src/save/serialized-store.ts`): the store itself
 * awaits in-flight writes before its `resetForNewGame(userId)`
 * runs, then permanently freezes future `save()` calls until the
 * page reloads. This hook can therefore be naive about
 * destructive flows — even if it fires a tick mid-reset, the
 * store rejects it.
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

  useEffect(() => {
    if (!source || !store || !userId) return;
    lastWrittenRef.current = null;
    let cancelled = false;

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
        if (
          !cancelled &&
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
}
