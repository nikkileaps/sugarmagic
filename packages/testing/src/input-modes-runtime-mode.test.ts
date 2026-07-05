/**
 * Story 50.1 — resolveRuntimeMode pure function tests.
 *
 * Guards the priority cascade: login-modal overrides everything;
 * mode-defining menu keys (start-menu, pause-menu, dialogue)
 * win over generic isPaused; non-mode-defining menu keys
 * (inventory, etc.) fall through to in-game.
 */

import { describe, expect, it } from "vitest";
import {
  resolveRuntimeMode,
  type GameLifecycle,
  type GameStateSnapshot,
  type RuntimeUIState
} from "@sugarmagic/runtime-core";

function makeState(patch: Partial<RuntimeUIState> = {}): RuntimeUIState {
  return {
    activeOverlayMenuKey: null,
    savePresent: false,
    loginModalOpen: false,
    episodesOpen: false,
    ...patch
  };
}

function makeGameState(
  lifecycle: GameLifecycle = "playing"
): GameStateSnapshot {
  return { lifecycle };
}

describe("resolveRuntimeMode", () => {
  it("returns in-game on a fresh runtime state", () => {
    expect(resolveRuntimeMode(makeState())).toBe("in-game");
  });

  it("returns login-modal when the modal flag is set, overriding every other field", () => {
    expect(
      resolveRuntimeMode(
        makeState({
          loginModalOpen: true,
          activeOverlayMenuKey: "start-menu"
        })
      )
    ).toBe("login-modal");
  });

  it("returns start-menu when lifecycle is 'start-menu'", () => {
    expect(
      resolveRuntimeMode(makeState(), makeGameState("start-menu"))
    ).toBe("start-menu");
  });

  it("returns paused when lifecycle is 'paused'", () => {
    expect(
      resolveRuntimeMode(makeState(), makeGameState("paused"))
    ).toBe("paused");
  });

  it("returns dialogue when activeOverlayMenuKey is dialogue and lifecycle is playing", () => {
    expect(
      resolveRuntimeMode(
        makeState({ activeOverlayMenuKey: "dialogue" }),
        makeGameState("playing")
      )
    ).toBe("dialogue");
  });

  it("lifecycle 'paused' overrides dialogue overlay (lifecycle dominates)", () => {
    expect(
      resolveRuntimeMode(
        makeState({ activeOverlayMenuKey: "dialogue" }),
        makeGameState("paused")
      )
    ).toBe("paused");
  });

  it("booting maps to paused (gameplay frozen)", () => {
    expect(
      resolveRuntimeMode(makeState(), makeGameState("booting"))
    ).toBe("paused");
  });

  it("falls through to in-game when a non-mode-defining menu (e.g. inventory) is visible", () => {
    // Inventory is an overlay opened during gameplay; the mode
    // stays in-game so other in-game shortcuts continue to work.
    // Critical contract: when 50.3 migrates the inventory
    // handler to register `modes: ["in-game"]`, pressing `i`
    // again to close still fires.
    expect(
      resolveRuntimeMode(makeState({ activeOverlayMenuKey: "inventory" }))
    ).toBe("in-game");
  });

  it("login-modal beats lifecycle beats overlay; lifecycle beats overlay", () => {
    // Explicit priority matrix. Lifecycle is the dominant axis
    // (because it represents the game's actual phase); overlays
    // only matter while playing.
    const cascade: Array<{
      ui: Partial<RuntimeUIState>;
      lifecycle: GameLifecycle;
      expected: ReturnType<typeof resolveRuntimeMode>;
    }> = [
      {
        ui: { loginModalOpen: true, activeOverlayMenuKey: "dialogue" },
        lifecycle: "playing",
        expected: "login-modal"
      },
      {
        ui: { activeOverlayMenuKey: "dialogue" },
        lifecycle: "start-menu",
        expected: "start-menu"
      },
      {
        ui: { activeOverlayMenuKey: "dialogue" },
        lifecycle: "paused",
        expected: "paused"
      },
      {
        ui: { activeOverlayMenuKey: "dialogue" },
        lifecycle: "playing",
        expected: "dialogue"
      },
      { ui: {}, lifecycle: "playing", expected: "in-game" }
    ];
    for (const { ui, lifecycle, expected } of cascade) {
      expect(
        resolveRuntimeMode(makeState(ui), makeGameState(lifecycle))
      ).toBe(expected);
    }
  });
});
