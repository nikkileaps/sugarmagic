/**
 * Runtime UI action registry tests.
 *
 * Verifies authored string-keyed UI actions are resolved by runtime-core
 * handlers instead of target-specific or authored JavaScript.
 */

import { describe, expect, it } from "vitest";
import {
  createUIActionRegistry,
  createUIStateStore,
  registerDefaultUIActions
} from "@sugarmagic/runtime-core";

describe("runtime UI action registry", () => {
  it("handles the default menu visibility actions", () => {
    const stateStore = createUIStateStore({
      visibleMenuKey: "start-menu",
      isPaused: true
    });
    const registry = createUIActionRegistry();
    registerDefaultUIActions(registry, {
      stateStore,
      startMenuKey: "start-menu",
      pauseMenuKey: "pause-menu"
    });

    registry.dispatch({ action: "start-new-game" });
    expect(stateStore.getState()).toEqual({
      visibleMenuKey: null,
      isPaused: false
    });

    registry.dispatch({ action: "pause-game" });
    expect(stateStore.getState()).toEqual({
      visibleMenuKey: "pause-menu",
      isPaused: true
    });

    registry.dispatch({ action: "resume-game" });
    expect(stateStore.getState()).toEqual({
      visibleMenuKey: null,
      isPaused: false
    });

    registry.dispatch({ action: "quit-to-menu" });
    expect(stateStore.getState()).toEqual({
      visibleMenuKey: "start-menu",
      isPaused: true
    });
  });

  it("routes load-region through an injected runtime callback", () => {
    const stateStore = createUIStateStore({
      visibleMenuKey: "pause-menu",
      isPaused: true
    });
    const loadedRegions: string[] = [];
    const registry = createUIActionRegistry();
    registerDefaultUIActions(registry, {
      stateStore,
      onLoadRegion: (regionId) => loadedRegions.push(regionId)
    });

    registry.dispatch({
      action: "load-region",
      args: { regionId: "region:two" }
    });

    expect(loadedRegions).toEqual(["region:two"]);
    expect(stateStore.getState().visibleMenuKey).toBeNull();
  });
});
