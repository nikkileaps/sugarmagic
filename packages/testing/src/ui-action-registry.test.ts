/**
 * Runtime UI action registry tests.
 *
 * Verifies authored string-keyed UI actions are resolved by runtime-core
 * handlers, which (post Plan 054 §054.4) delegate to the host's
 * `transitions` object instead of mutating UIStateStore directly.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createUIActionRegistry,
  createUIStateStore,
  registerDefaultUIActions,
  type GameLifecycleTransitions
} from "@sugarmagic/runtime-core";

function makeStubTransitions(): {
  transitions: GameLifecycleTransitions;
  spies: Record<keyof GameLifecycleTransitions, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    startNewGame: vi.fn(),
    continueGame: vi.fn(),
    pauseGame: vi.fn(),
    resumeGame: vi.fn(),
    quitToMenu: vi.fn()
  };
  return { transitions: spies, spies };
}

describe("runtime UI action registry", () => {
  it("lifecycle ui-actions delegate to the host's transition methods", () => {
    const stateStore = createUIStateStore();
    const { transitions, spies } = makeStubTransitions();
    const registry = createUIActionRegistry();
    registerDefaultUIActions(registry, { stateStore, transitions });

    registry.dispatch({ action: "start-new-game" });
    expect(spies.startNewGame).toHaveBeenCalledTimes(1);

    registry.dispatch({ action: "continue-game" });
    expect(spies.continueGame).toHaveBeenCalledTimes(1);

    registry.dispatch({ action: "pause-game" });
    expect(spies.pauseGame).toHaveBeenCalledTimes(1);

    registry.dispatch({ action: "resume-game" });
    expect(spies.resumeGame).toHaveBeenCalledTimes(1);

    registry.dispatch({ action: "quit-to-menu" });
    expect(spies.quitToMenu).toHaveBeenCalledTimes(1);
  });

  it("routes load-region through the injected runtime callback and resumes via continueGame", () => {
    const stateStore = createUIStateStore();
    const loadedRegions: string[] = [];
    const { transitions, spies } = makeStubTransitions();
    const registry = createUIActionRegistry();
    registerDefaultUIActions(registry, {
      stateStore,
      transitions,
      onLoadRegion: (regionId) => loadedRegions.push(regionId)
    });

    registry.dispatch({
      action: "load-region",
      args: { regionId: "region:two" }
    });

    expect(loadedRegions).toEqual(["region:two"]);
    // load-region implicitly "returns to gameplay" after picking the
    // region — same effect as Continue.
    expect(spies.continueGame).toHaveBeenCalledTimes(1);
  });
});
