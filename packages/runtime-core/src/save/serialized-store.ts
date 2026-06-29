/**
 * packages/runtime-core/src/save/serialized-store.ts
 *
 * Purpose: Wrap an arbitrary `GameSaveStore` with two structural
 * guarantees the raw stores can't provide on their own:
 *
 *   1. **Serial ordering.** Every `load` / `save` / `clear` /
 *      `resetForNewGame` call chains off a single internal
 *      "previous operation" Promise. The store enforces the
 *      relative order of operations — callers don't need to
 *      hand-coordinate via Promise chains, mutexes, or
 *      per-callsite "halt" handles.
 *
 *   2. **Reset finality.** `resetForNewGame(userId)` performs the
 *      delete and then permanently flips the store into a frozen
 *      state for the lifetime of this instance: any subsequent
 *      `save()` becomes a no-op (warn logged); `clear()` and the
 *      reset itself are idempotent. New page loads construct a
 *      fresh store with no freeze; the freeze only outlives the
 *      reload if the page never navigates (in which case the
 *      player is in limbo and silent autosaves writing would
 *      corrupt the now-cleared state).
 *
 * Why both: the New Game / sign-out / account-deletion flow
 * needs to (a) finish whatever autosave tick is mid-write before
 * the delete runs, and (b) guarantee no FUTURE write can land
 * after the delete. The 053.7 halt() fix delivered (a) at the
 * autosave-hook layer but is per-hook-generation, fragile to
 * deps changing, and demands every callsite remember to call
 * halt(). Moving the guarantee into the store removes the
 * convention and makes the structural bug impossible by
 * construction.
 *
 * The contract is the same `GameSaveStore` plus an additional
 * `resetForNewGame(userId)`. Resolved active stores ALWAYS go
 * through this wrapper (see `resolveActiveGameSaveStore`).
 *
 * Status: active
 */

import type { GameSave, GameSaveStore } from "./index";

/**
 * The wrapped store. Extends `GameSaveStore` with the
 * one-shot atomic reset operation.
 */
export interface SerializedSaveStore extends GameSaveStore {
  /**
   * Atomic destructive reset:
   *   1. Awaits any in-flight serialized op already accepted by
   *      this store (save / clear).
   *   2. Performs the delete.
   *   3. Freezes the store: subsequent `save()` calls become
   *      no-ops (a single warn is logged per frozen instance);
   *      `load()` and `clear()` continue to operate normally.
   *
   * After this returns:
   *   - The user's save row is deleted.
   *   - No autosave tick, no other writer, no future caller of
   *     `save()` against this store instance can re-introduce
   *     state — by construction, not by convention.
   *
   * If the underlying delete rejects, this still freezes the
   * store (defense-in-depth: we don't know what landed) and
   * re-throws so the caller can decide how to recover (e.g.
   * reload anyway).
   *
   * Designed for the New Game flow, which calls this and then
   * `window.location.reload()`. The freeze only needs to last
   * until the reload; the next page load constructs a fresh
   * store.
   *
   * NOT a routine clear: use `clear(userId)` when you want to
   * delete the save but keep accepting writes afterward (e.g.
   * the anon-to-cloud migration in `migrateLocalSaveToCloud`).
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

  // Single Promise chain: every operation appends to `chain` and
  // updates `chain` to the new tail. Each operation awaits the
  // chain head before doing its own work, so concurrent callers
  // serialize in arrival order without leaking exceptions
  // forward (the chain is wrapped to swallow + log so one
  // failed op doesn't poison the next).
  let chain: Promise<unknown> = Promise.resolve();
  let frozen = false;
  let frozenWarned = false;

  function enqueue<T>(label: string, work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => {
      // already logged at the call site; keep the chain alive
    });
    return next.catch((err) => {
      throw err instanceof Error
        ? err
        : new Error(
            `[runtime-core] serialized save-store ${label} failed: ${String(err)}`
          );
    });
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
    load(userId): Promise<GameSave | null> {
      return enqueue("load", () => raw.load(userId));
    },
    save(userId, save): Promise<void> {
      if (frozen) {
        warnIfFrozen("save");
        return Promise.resolve();
      }
      return enqueue("save", () => {
        if (frozen) {
          // Race: a resetForNewGame won the chain while this
          // task was queued. Drop the write.
          warnIfFrozen("save");
          return Promise.resolve();
        }
        return raw.save(userId, save);
      });
    },
    clear(userId): Promise<void> {
      return enqueue("clear", () => raw.clear(userId));
    },
    resetForNewGame(userId): Promise<void> {
      return enqueue("resetForNewGame", async () => {
        // Flip the freeze BEFORE the delete so any save() that
        // got past `frozen` check at the top of `save()` and is
        // sitting in the chain behind us drops to a no-op when
        // it reaches its inner `if (frozen)` re-check.
        frozen = true;
        try {
          await raw.clear(userId);
        } catch (err) {
          // Re-throw so caller knows the delete didn't land;
          // store stays frozen either way.
          throw err;
        }
      });
    }
  };

  return wrapped;
}
