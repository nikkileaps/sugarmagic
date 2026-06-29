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
  deriveLifecycleFromUIState,
  isGameInProgress,
  isGamePaused,
  type GameLifecycle,
  type RuntimeUIState
} from "@sugarmagic/runtime-core";

describe("createGameStateStore", () => {
  it("defaults to booting / no save", () => {
    const store = createGameStateStore();
    expect(store.getState()).toEqual({
      lifecycle: "booting",
      savePresent: false
    });
  });

  it("accepts initial overrides", () => {
    const store = createGameStateStore({
      lifecycle: "start-menu",
      savePresent: true
    });
    expect(store.getState()).toEqual({
      lifecycle: "start-menu",
      savePresent: true
    });
  });

  it("setState patches merge onto current state", () => {
    const store = createGameStateStore({ savePresent: true });
    store.setState({ lifecycle: "playing" });
    expect(store.getState()).toEqual({
      lifecycle: "playing",
      savePresent: true
    });
    store.setState({ savePresent: false });
    expect(store.getState()).toEqual({
      lifecycle: "playing",
      savePresent: false
    });
  });

  it("setState accepts an updater function", () => {
    const store = createGameStateStore();
    store.setState((prev) => ({
      ...prev,
      lifecycle: "playing"
    }));
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

  it("subscribe / getState are useSyncExternalStore-compatible (subscribe returns an unsubscribe fn; getState returns a snapshot)", () => {
    const store = createGameStateStore();
    expect(typeof store.subscribe).toBe("function");
    expect(typeof store.getState).toBe("function");
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
      const snapshot = { lifecycle, savePresent: false };
      expect(isGameInProgress(snapshot)).toBe(inProgress);
      expect(isGamePaused(snapshot)).toBe(paused);
    });
  }
});

// Plan 054 §054.3 — migration bridge derivation.
describe("deriveLifecycleFromUIState", () => {
  const base: RuntimeUIState = {
    activeOverlayMenuKey: null,
    isPaused: false,
    savePresent: false,
    loginModalOpen: false
  };

  const cases: Array<{
    name: string;
    patch: Partial<RuntimeUIState>;
    expected: GameLifecycle;
  }> = [
    {
      name: "activeOverlayMenuKey='start-menu' -> start-menu (regardless of isPaused)",
      patch: { activeOverlayMenuKey: "start-menu", isPaused: true },
      expected: "start-menu"
    },
    {
      name: "activeOverlayMenuKey='pause-menu' -> paused",
      patch: { activeOverlayMenuKey: "pause-menu", isPaused: true },
      expected: "paused"
    },
    {
      name: "isPaused=true (no menu key) -> paused",
      patch: { isPaused: true },
      expected: "paused"
    },
    {
      name: "everything default (menu null, not paused) -> playing",
      patch: {},
      expected: "playing"
    },
    {
      name: "overlay menu (dialogue) does NOT trigger lifecycle change",
      patch: { activeOverlayMenuKey: "dialogue", isPaused: false },
      expected: "playing"
    },
    {
      name: "loginModalOpen alone does NOT trigger lifecycle change",
      patch: { loginModalOpen: true },
      expected: "playing"
    }
  ];

  for (const { name, patch, expected } of cases) {
    it(name, () => {
      expect(deriveLifecycleFromUIState({ ...base, ...patch })).toBe(expected);
    });
  }
});
