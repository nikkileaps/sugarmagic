/**
 * Plan 054 §054.2 — `GameStateStore` unit coverage.
 *
 * Asserts the store's basics: default initial state, setState
 * patch + updater semantics, subscribe / unsubscribe, and the
 * derived selectors.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createGameStateStore,
  isGameInProgress,
  isGamePaused,
  type GameLifecycle
} from "@sugarmagic/runtime-core";

describe("createGameStateStore", () => {
  it("defaults to lifecycle: 'booting'", () => {
    const store = createGameStateStore();
    expect(store.getState()).toEqual({ lifecycle: "booting" });
  });

  it("accepts initial lifecycle override", () => {
    const store = createGameStateStore({ lifecycle: "start-menu" });
    expect(store.getState()).toEqual({ lifecycle: "start-menu" });
  });

  it("setState patches merge onto current state", () => {
    const store = createGameStateStore({ lifecycle: "start-menu" });
    store.setState({ lifecycle: "playing" });
    expect(store.getState()).toEqual({ lifecycle: "playing" });
    store.setState({ lifecycle: "paused" });
    expect(store.getState()).toEqual({ lifecycle: "paused" });
  });

  it("setState accepts an updater function", () => {
    const store = createGameStateStore();
    store.setState((prev) => ({ ...prev, lifecycle: "playing" }));
    expect(store.getState().lifecycle).toBe("playing");
  });

  it("subscribe fires on every setState; unsubscribe stops it", () => {
    const store = createGameStateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState({ lifecycle: "start-menu" });
    expect(listener).toHaveBeenCalledTimes(1);
    store.setState({ lifecycle: "playing" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setState({ lifecycle: "paused" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("subscribe / getState are useSyncExternalStore-compatible", () => {
    const store = createGameStateStore();
    const unsubscribe = store.subscribe(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
    expect(typeof store.getState()).toBe("object");
  });
});

describe("selectors", () => {
  const cases: Array<{
    lifecycle: GameLifecycle;
    inProgress: boolean;
    paused: boolean;
  }> = [
    { lifecycle: "booting", inProgress: false, paused: true },
    { lifecycle: "start-menu", inProgress: false, paused: true },
    { lifecycle: "playing", inProgress: true, paused: false },
    { lifecycle: "paused", inProgress: false, paused: true }
  ];

  for (const { lifecycle, inProgress, paused } of cases) {
    it(`lifecycle="${lifecycle}" -> inProgress=${inProgress}, paused=${paused}`, () => {
      const snapshot = { lifecycle };
      expect(isGameInProgress(snapshot)).toBe(inProgress);
      expect(isGamePaused(snapshot)).toBe(paused);
    });
  }
});
