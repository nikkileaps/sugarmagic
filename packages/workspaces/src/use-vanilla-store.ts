/**
 * React bridge for external vanilla stores.
 *
 * Workspaces consume shell-owned zustand vanilla stores structurally through
 * this hook instead of taking a direct dependency on zustand's React adapter.
 *
 * `useSyncExternalStore` uses `Object.is` to decide whether the snapshot
 * changed. A selector that returns a freshly allocated object or array on
 * every call (e.g. `(s) => s.maybeNull?.arr ?? [0, 0, 0, 1]`) will look like
 * a changed snapshot on every read and trigger an infinite render loop.
 * This hook defends against that by caching the last selector result and
 * reusing it when the caller-supplied `equalityFn` reports equality.
 */

import { useRef, useSyncExternalStore } from "react";

export interface ReadableStore<TState> {
  subscribe: (listener: () => void) => () => void;
  getState: () => TState;
}

export function useVanillaStoreSelector<TState, TSelected>(
  store: ReadableStore<TState>,
  selector: (state: TState) => TSelected,
  equalityFn: (left: TSelected, right: TSelected) => boolean = Object.is
): TSelected {
  const cache = useRef<{ hasValue: boolean; value: TSelected }>({
    hasValue: false,
    value: undefined as TSelected
  });

  const getSnapshot = () => {
    const next = selector(store.getState());
    if (cache.current.hasValue && equalityFn(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { hasValue: true, value: next };
    return next;
  };

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
