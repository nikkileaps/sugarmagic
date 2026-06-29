/**
 * packages/runtime-core/src/util/observable-value.ts
 *
 * Snapshot+subscribe primitive for runtime-host handoffs.
 * Story 51.1.
 *
 * Shape matches React's `useSyncExternalStore` contract verbatim:
 *
 *   - `getSnapshot()` returns the current value at any time.
 *   - `subscribe(listener)` registers a change notifier; returns
 *     an unsubscribe function. The listener takes no args — it's
 *     a "pull on next read" signal, not a value-push.
 *
 * Same semantics as RxJS's `BehaviorSubject`: late subscribers
 * see the current value via `getSnapshot()` at subscribe time,
 * then receive change notifications going forward. Eliminates
 * the "I missed the only event" failure class that Plan 047
 * §47.10 hit with `EventTarget`-based handoffs.
 *
 * Equality is checked via `Object.is`. A `set()` whose value
 * equals the current value is a no-op (no listener fired). This
 * matches React's contract for stable snapshots: subscribers
 * shouldn't see spurious re-renders when nothing changed.
 *
 * Single value per store, intentionally. Selector-based
 * subscription (`subscribe to user.email only`) is a deferred
 * design choice — if you find yourself reaching for it, see
 * Plan 051's `Deferred` section
 * (`docs/plans/051-runtime-handoff-load-order-architecture.md`)
 * for the concrete trigger conditions that should be met before
 * adding selectors. Don't add them speculatively.
 */

/**
 * Read-only view of an observable value. Consumers that should
 * not be able to mutate the store (Studio React subscribers,
 * HUD card getters, plugin code) accept this type; only the
 * host (or whatever owns the store's lifecycle) accepts
 * `MutableObservableValue<T>`.
 */
export interface ObservableValue<T> {
  getSnapshot(): T;
  /**
   * Register a change notifier. The listener fires when
   * `set(next)` is called with a value not `Object.is`-equal
   * to the current. Returns an unsubscribe function — idempotent
   * (calling it twice is a no-op).
   */
  subscribe(listener: () => void): () => void;
}

export interface MutableObservableValue<T> extends ObservableValue<T> {
  /**
   * Replace the stored value. Listeners fire when the new value
   * is not `Object.is`-equal to the current; otherwise this is
   * a no-op.
   */
  set(next: T): void;
}

export function createObservableValue<T>(
  initial: T
): MutableObservableValue<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot() {
      return current;
    },
    set(next) {
      if (Object.is(next, current)) return;
      current = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
