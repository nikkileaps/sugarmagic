/**
 * packages/runtime-core/src/save/serialized-store.ts
 *
 * Wrap a raw `GameSaveStore` with two structural guarantees:
 *
 *   1. Every operation serializes on a single Promise chain so
 *      concurrent callers run in arrival order, with no
 *      hand-coordination at the callsite.
 *   2. `resetForNewGame(userId)` atomically awaits in-flight
 *      writes, deletes the row, and permanently freezes the
 *      store: subsequent `save()` calls are no-ops. The freeze
 *      lives for the instance's lifetime — a page reload
 *      constructs a fresh store.
 *
 * Replaces the per-callsite `useAutosave.halt()` contract that
 * shipped with story 053.7: that fix required every destructive
 * callsite to remember to flush autosave first, and the per-hook
 * `haltedRef` reset whenever the hook's deps changed. Moving the
 * guarantee into the store makes the bug impossible by
 * construction rather than by convention.
 *
 * `resolveActiveGameSaveStore` wraps every active store through
 * `createSerializedSaveStore` so all consumers get the contract
 * automatically.
 *
 * Status: active
 */

import type { GameSave, GameSaveStore } from "./index";

/** GameSaveStore plus the one-shot atomic reset operation. */
export interface SerializedSaveStore extends GameSaveStore {
  /**
   * Atomically: await any in-flight serialized op, delete the
   * user's save, then freeze the store so future `save()` calls
   * are no-ops. `load()` and `clear()` keep working. On
   * underlying delete failure the store stays frozen (defense
   * in depth) and the rejection propagates so the caller can
   * decide whether to reload anyway.
   *
   * Used by New Game / sign-out / account-deletion flows that
   * end in `window.location.reload()`. For non-destructive
   * removals (anon-to-cloud migration), use `clear(userId)` —
   * that path keeps the store writable.
   */
  resetForNewGame(userId: string): Promise<void>;
}

const WRAPPED_BRAND = Symbol.for("sugarmagic.serializedSaveStore");

interface WrappedBrand {
  [WRAPPED_BRAND]?: true;
}

/**
 * Wraps a raw `GameSaveStore` with the serialization + reset
 * guarantees described in the file header. Idempotent: passing
 * an already-wrapped store returns it unchanged so the resolver
 * can wrap defensively without double-wrapping plugin stores
 * that happen to be wrapped already.
 */
export function createSerializedSaveStore(
  raw: GameSaveStore
): SerializedSaveStore {
  const branded = raw as GameSaveStore & WrappedBrand;
  if (branded[WRAPPED_BRAND]) {
    return raw as SerializedSaveStore;
  }

  // Single Promise chain: every op appends to `chain` and
  // updates `chain` to the new tail, so concurrent callers
  // serialize in arrival order. The chain swallows rejections
  // so one failed op doesn't poison the next.
  let chain: Promise<unknown> = Promise.resolve();
  let frozen = false;
  let frozenWarned = false;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    // chain.then(work, work) runs `work` whether the prior op
    // resolved or rejected — one op's failure must not stop the
    // next from running. The local `chain` swallows so a
    // rejection doesn't propagate forward.
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  }

  function warnIfFrozen(operation: string): void {
    if (!frozen) return;
    if (frozenWarned) return;
    frozenWarned = true;
    console.warn(
      `[runtime-core] save-store is frozen (resetForNewGame ran); ${operation}() called after reset is a no-op. This is expected during the New Game -> reload flow.`
    );
  }

  const wrapped: SerializedSaveStore & WrappedBrand = {
    [WRAPPED_BRAND]: true,
    load(userId) {
      return enqueue(() => raw.load(userId));
    },
    save(userId, save) {
      if (frozen) {
        warnIfFrozen("save");
        return Promise.resolve();
      }
      return enqueue(() => {
        // Re-check inside the chained task: a resetForNewGame
        // may have flipped `frozen` while we were queued.
        if (frozen) {
          warnIfFrozen("save");
          return Promise.resolve();
        }
        return raw.save(userId, save);
      });
    },
    clear(userId) {
      return enqueue(() => raw.clear(userId));
    },
    resetForNewGame(userId) {
      return enqueue(async () => {
        // Flip freeze BEFORE the delete so any save() already
        // sitting in the chain behind us drops to a no-op when
        // it reaches its inner `if (frozen)` re-check.
        frozen = true;
        await raw.clear(userId);
      });
    }
  };

  return wrapped;
}
